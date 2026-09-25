import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePageTitle } from "@sapporta/frontend/shell";
import type { OpeningBalances } from "../../../shared/index";
import { Button } from "../../components/ui/button";
import { joinNames } from "../../format";
import {
  openingBalancesQuery,
  refreshSetup,
  statementAccountsQuery,
} from "../../queries";
import {
  FocusCard,
  FocusLoading,
  type FocusFrame,
} from "../../components/focus-card";
import { SETUP_HAND_OFF_HREF } from "../../review/routes";
import { accountsInBooks, contextLine } from "../words";
import { RecordBalance } from "./RecordBalance";
import {
  afterRecording,
  nothingLeftTitle,
  otherCard,
  otherHref,
  readOtherUrl,
  recordedNames,
  unrecorded,
  type OtherUrl,
} from "./state";

/**
 * /add/other: card 6 on the first run, and C1, which records the balance
 * of an account from the chart that no statement comes from. The card is
 * the URL's (`otherCard`); the list of accounts is the books'.
 */
export function AddOther() {
  usePageTitle("Add a balance");
  const [params] = useSearchParams();
  const url = readOtherUrl(params);
  const navigate = useNavigate();
  const client = useQueryClient();
  const balances = useQuery(openingBalancesQuery);
  const statements = useQuery({
    ...statementAccountsQuery,
    enabled: url.setup,
  });

  const frame: FocusFrame = {
    context: url.setup
      ? contextLine(
          { setup: true, from: null, added: null },
          statements.data ? accountsInBooks(statements.data) : 0,
        )
      : "Adding a balance",
  };

  if (otherCard(url) === "anything-else") {
    return <AnythingElse frame={frame} data={balances.data} />;
  }

  const data = balances.data;
  if (data === undefined) {
    return (
      <FocusLoading
        {...frame}
        error={balances.isError ? balances.error : null}
        retry={() => void balances.refetch()}
      />
    );
  }

  const choices = unrecorded(data);
  if (choices.length === 0) {
    return <NothingLeft frame={frame} url={url} data={data} />;
  }
  return (
    <RecordBalance
      frame={frame}
      choices={choices}
      back={url.setup ? otherHref({ setup: true }) : null}
      onRecorded={() =>
        // Card 6 says what is recorded from the list, so it moves on once
        // the list has the new balance.
        void refreshSetup(client).then(() => navigate(afterRecording(url)))
      }
      onRefused={() => void balances.refetch()}
    />
  );
}

/**
 * Card 6, first run only: the accounts no statement comes from. It comes
 * after every bank and card, and hands off to Review.
 */
function AnythingElse({
  frame,
  data,
}: {
  frame: FocusFrame;
  data: OpeningBalances | undefined;
}) {
  const recorded = data ? recordedNames(data) : [];
  return (
    <FocusCard
      {...frame}
      title="Cash, a deposit, a loan?"
      lead={
        recorded.length === 0 ? (
          "Record what each held when your books start."
        ) : (
          <span className="text-primary">
            <span aria-hidden="true">✓</span> {joinNames(recorded)} recorded
          </span>
        )
      }
      actions={
        <>
          <Button
            variant="outline"
            render={<Link to={SETUP_HAND_OFF_HREF} />}
            nativeButton={false}
          >
            That's all
          </Button>
          <Button
            render={<Link to={otherHref({ setup: true, record: true })} />}
            nativeButton={false}
          >
            Add one
          </Button>
        </>
      }
    />
  );
}

/**
 * C1 with no account to offer. C1 makes no accounts, so the way on is the
 * Accounts page; on the first run, card 6's "That's all".
 */
function NothingLeft({
  frame,
  url,
  data,
}: {
  frame: FocusFrame;
  url: OtherUrl;
  data: OpeningBalances;
}) {
  return (
    <FocusCard
      {...frame}
      title={nothingLeftTitle(data)}
      lead="Add an account on the Accounts page, then come back."
      actions={
        <>
          {/* In a new tab, so the run stays here to come back to. */}
          <Button
            variant="outline"
            render={<Link to="/accounts" target="_blank" rel="noopener" />}
            nativeButton={false}
          >
            Accounts page
          </Button>
          <Button
            render={<Link to={url.setup ? SETUP_HAND_OFF_HREF : "/"} />}
            nativeButton={false}
          >
            {url.setup ? "That's all" : "Done"}
          </Button>
        </>
      }
    />
  );
}
