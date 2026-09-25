import { useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePageTitle } from "@sapporta/frontend/shell";
import type { AccountKind, AddAccountFields } from "../../shared/index";
import { apiErrorMessage } from "../api";
import { refreshSetup, statementAccountsQuery } from "../queries";
import { draftsHandOffHref } from "../review/routes";
import type { ProblemAction } from "../views/import-statements/describeProblems";
import {
  IMPORT_ROUTE,
  importWithFiles,
} from "../views/import-statements/files";
import { Another } from "./Another";
import {
  Balance,
  GapCard,
  InBooks,
  KindCard,
  LateStart,
  NoTransactions,
  OpeningRefused,
  Refused,
  Several,
  Teach,
} from "./conditions";
import { Confirm } from "./Confirm";
import { Drop, ReadFailed, Reading as ReadingCard } from "./Drop";
import { FocusLoading, type FocusFrame } from "./FocusCard";
import { HowFarBack } from "./HowFarBack";
import { refusalProblems } from "./refusal";
import {
  addCard,
  addHref,
  carriedFrom,
  readAddUrl,
  type From,
  type Reading,
} from "./state";
import { otherHref } from "./other/state";
import { readStatements, sendAdd } from "./upload";
import {
  accountsInBooks,
  addedName,
  candidateName,
  contextLine,
  severalTitle,
} from "./words";

/** Files are one file when their name and size agree, as /import counts them. */
function fileKey(file: File): string {
  return `${file.name}:${file.size}`;
}

/**
 * /add: a bank or card from its statements, one card at a time (PLAN.md,
 * cards 2–5 and 7 and the conditional cards). The card is `addCard`'s, from
 * the URL and what this screen holds: the dropped files, the read of them,
 * and the answers given since. Nothing is written until Confirm's "Add to
 * books"; after it, the URL says where the flow is, so a reload or Back
 * lands on a card the books agree with.
 */
export function AddAccount() {
  usePageTitle("Add a bank or card");
  const [params] = useSearchParams();
  const url = readAddUrl(params);
  const navigate = useNavigate();
  const location = useLocation();
  const client = useQueryClient();
  const accounts = useQuery(statementAccountsQuery);
  const data = accounts.data;

  const [files, setFiles] = useState<File[]>([]);
  const [reading, setReading] = useState<Reading | null>(null);
  const [addMore, setAddMore] = useState(false);
  const [kind, setKind] = useState<AccountKind | null>(null);
  const [opening, setOpening] = useState<number | null>(null);
  const [checkedAgain, setCheckedAgain] = useState(false);
  // The server's refusal of the last add, shown under Confirm's button.
  const [addRefusal, setAddRefusal] = useState<string | null>(null);
  // Only the latest read's answer counts.
  const readCount = useRef(0);

  /**
   * Makes `set` the files, and reads them; answers given before go. A quiet
   * read keeps the card in view until the answer comes.
   */
  async function read(set: File[], { quiet = false } = {}) {
    const count = ++readCount.current;
    setFiles(set);
    setAddMore(false);
    if (!quiet) {
      setKind(null);
      setOpening(null);
      setAddRefusal(null);
    }
    if (set.length === 0) {
      setReading(null);
      return;
    }
    if (!quiet) setReading({ state: "reading" });
    try {
      const reply = await readStatements(set);
      if (count === readCount.current) {
        setReading({ state: "read", reading: reply });
      }
    } catch (error) {
      if (count === readCount.current) {
        setReading({ state: "failed", message: apiErrorMessage(error) });
      }
    }
  }

  function drop(incoming: File[]) {
    const seen = new Set(files.map(fileKey));
    const fresh = incoming.filter((file) => !seen.has(fileKey(file)));
    setCheckedAgain(false);
    void read([...files, ...fresh]);
  }

  // The cards name held files by their position in the drop (state.ts);
  // a refusal's own fixes name them as /import does, by file name.
  const withoutAt = (at: readonly number[]) =>
    files.filter((_, i) => !at.includes(i));
  const onlyAt = (at: readonly number[]) =>
    files.filter((_, i) => at.includes(i));
  const without = (names: readonly string[]) =>
    files.filter((file) => !names.includes(file.name));
  const only = (names: readonly string[]) =>
    files.filter((file) => names.includes(file.name));

  function startOver() {
    setCheckedAgain(false);
    void read([]);
  }

  /** Card 2's answer, or a later start the user chose, in the URL. */
  function goFrom(from: From, replace = false) {
    navigate(addHref({ setup: url.setup, from }), { replace });
  }

  async function add(fields: AddAccountFields): Promise<void> {
    setAddRefusal(null);
    const reply = await sendAdd(files, fields).catch(
      (error: unknown) =>
        ({ kind: "failed", message: apiErrorMessage(error) }) as const,
    );
    if (reply.kind === "failed") {
      setAddRefusal(reply.message);
      return;
    }
    await refreshSetup(client);
    if (reply.kind === "refused") {
      setAddRefusal(reply.refusal.error);
      // A refusal partway can leave the account set up, with no
      // transactions: read again, so the card follows the books.
      await read(files, { quiet: true });
      return;
    }
    const { account_id } = reply.added;
    readCount.current++;
    setFiles([]);
    setReading(null);
    if (url.setup) {
      // Card 5 comes from the URL, so a reload shows it again.
      navigate(addHref({ ...url, added: account_id }), { replace: true });
    } else {
      navigate(draftsHandOffHref(account_id));
    }
  }

  function addAnother() {
    readCount.current++;
    setFiles([]);
    setReading(null);
    setAddMore(false);
    setKind(null);
    setOpening(null);
    setAddRefusal(null);
    setCheckedAgain(false);
    navigate(addHref({ setup: url.setup }), { state: { from: url.from } });
  }

  const card = addCard(url, {
    files: files.length,
    reading,
    addMore,
    kind,
    opening,
  });
  const frame: FocusFrame = {
    context: contextLine(url, data ? accountsInBooks(data) : 0),
  };
  const theRead = reading?.state === "read" ? reading.reading : null;

  switch (card.card) {
    case "another":
      return (
        <Another
          frame={frame}
          name={addedName(card.accountId, data)}
          thatsAll={otherHref({ setup: true })}
          onAnother={addAnother}
        />
      );
    case "how-far-back":
      return (
        <HowFarBack
          frame={frame}
          url={url}
          initial={carriedFrom(location.state)}
          onAnswer={(from) => goFrom(from)}
        />
      );
    case "drop":
      return (
        <Drop
          frame={frame}
          from={url.from!}
          held={files}
          onFiles={drop}
          onBack={() => setAddMore(false)}
        />
      );
    case "reading":
      return <ReadingCard frame={frame} files={files.length} />;
    case "read-failed":
      return (
        <ReadFailed
          frame={frame}
          message={card.message}
          onRetry={() => void read(files)}
          onStartOver={startOver}
        />
      );
    case "teach":
      return (
        <Teach
          frame={frame}
          files={card.files}
          readable={card.readable}
          stillUnreadable={checkedAgain}
          onCheckAgain={() => {
            setCheckedAgain(true);
            void read(files);
          }}
          onLeaveOut={() => void read(withoutAt(card.at))}
        />
      );
    case "several": {
      const [first] = card.accounts;
      return (
        <Several
          frame={frame}
          title={severalTitle(card.accounts, data)}
          first={candidateName(first, first.kind, data)}
          onStart={() => void read(onlyAt(card.firstAt))}
        />
      );
    }
    case "in-books":
      return (
        <InBooks
          frame={frame}
          name={candidateName(card.account, card.account.kind, data)}
          onImport={() =>
            navigate(IMPORT_ROUTE, { state: importWithFiles(files) })
          }
        />
      );
    case "no-transactions":
      return <NoTransactions frame={frame} onStartOver={startOver} />;
    case "gap":
      return (
        <GapCard
          frame={frame}
          gap={card.gap}
          onAddIt={() => setAddMore(true)}
          onStartFrom={() => {
            // The user chose to start after the gap, so a month asked for
            // earlier no longer applies.
            if (url.from?.kind === "month") {
              goFrom({ kind: "month", month: card.gap.resumesIn }, true);
            }
            void read(withoutAt(card.gap.before));
          }}
        />
      );
    case "refused": {
      const accountKind = card.account.kind ?? kind;
      const name = candidateName(card.account, accountKind, data);
      return (
        <Refused
          frame={frame}
          problems={refusalProblems(
            card.account,
            card.refusal,
            theRead?.files ?? [],
            name,
            accountKind,
          )}
          promptsAgent={card.promptsAgent}
          onAction={(action: ProblemAction) => {
            if (action.kind === "remove-files") {
              void read(without(action.fileNames));
            } else if (action.kind === "keep-only-files") {
              void read(only(action.fileNames));
            } else {
              navigate(action.to);
            }
          }}
          onCheckAgain={() => void read(files)}
          onStartOver={startOver}
        />
      );
    }
    case "opening-refused":
      return (
        <OpeningRefused
          frame={frame}
          error={card.error}
          onStartOver={startOver}
        />
      );
    case "late-start":
      return (
        <LateStart
          frame={frame}
          from={card.from}
          starts={card.starts}
          onAddMore={() => setAddMore(true)}
          onStartFrom={() =>
            goFrom({ kind: "month", month: card.starts }, true)
          }
        />
      );
    case "kind":
      return (
        <KindCard
          frame={frame}
          institution={card.account.institution}
          onKind={setKind}
        />
      );
    case "balance":
      return (
        <Balance
          frame={frame}
          name={candidateName(card.account, card.kind, data)}
          kind={card.kind}
          date={card.date}
          onAnswer={setOpening}
        />
      );
    case "confirm":
      if (data === undefined) {
        return (
          <FocusLoading
            {...frame}
            error={accounts.isError ? accounts.error : null}
            retry={() => void accounts.refetch()}
          />
        );
      }
      return (
        <Confirm
          key={card.account.key}
          frame={frame}
          account={card.account}
          kind={card.kind}
          opening={card.opening}
          categorizer={card.categorizer}
          data={data}
          refusal={addRefusal}
          onAdd={add}
        />
      );
  }
}
