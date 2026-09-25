import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePageTitle } from "@sapporta/frontend/shell";
import type { OpeningBalances } from "../../../shared/index";
import { apiErrorMessage } from "../../api";
import { Button } from "../../components/ui/button";
import {
  openingBalancesQuery,
  refreshSetup,
  statementAccountsQuery,
} from "../../queries";
import { FocusCard, type FocusFrame } from "../FocusCard";
import { accountsInBooks, contextLine } from "../words";
import { RecordBalance } from "./RecordBalance";
import {
  afterRecording,
  nothingLeftTitle,
  otherCard,
  otherHref,
  readOtherUrl,
  SETUP_HAND_OFF,
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
    return <AnythingElse frame={frame} url={url} data={balances.data} />;
  }

  const data = balances.data;
  if (data === undefined) {
    return balances.isError ? (
      <FocusCard
        {...frame}
        title="Couldn't load your accounts"
        lead={
          <span role="alert" className="text-destructive">
            {apiErrorMessage(balances.error)}
          </span>
        }
        actions={
          <Button onClick={() => void balances.refetch()}>Try again</Button>
        }
      />
    ) : (
      <FocusCard {...frame} title="Loading…" />
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
      onRecorded={(accountId) => {
        // Card 6 names the account from the list as it was, so the
        // refresh can follow the move.
        navigate(afterRecording(url, accountId));
        void refreshSetup(client);
      }}
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
  url,
  data,
}: {
  frame: FocusFrame;
  url: OtherUrl;
  data: OpeningBalances | undefined;
}) {
  const recorded =
    url.recorded === null
      ? null
      : (data?.accounts.find((one) => one.account_id === url.recorded)?.name ??
        null);
  return (
    <FocusCard
      {...frame}
      title="Cash, a deposit, a loan?"
      lead={
        recorded === null ? (
          "Record what each held when your books start."
        ) : (
          <span className="text-primary">
            <span aria-hidden="true">✓</span> {recorded} recorded
          </span>
        )
      }
      actions={
        <>
          <Button
            variant="outline"
            render={<Link to={SETUP_HAND_OFF} />}
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
          <Button
            variant="outline"
            render={<Link to="/accounts" />}
            nativeButton={false}
          >
            Accounts page
          </Button>
          <Button
            render={<Link to={url.setup ? SETUP_HAND_OFF : "/"} />}
            nativeButton={false}
          >
            {url.setup ? "That's all" : "Done"}
          </Button>
        </>
      }
    />
  );
}
