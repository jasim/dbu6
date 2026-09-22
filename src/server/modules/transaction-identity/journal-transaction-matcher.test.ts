import { describe, expect, it } from "vitest";
import {
  matchTransactionToJournal,
  type JournalCandidate,
} from "./journal-transaction-matcher.js";
import type { TransactionIdentityInput } from "./transaction-identity.js";

const purchase: TransactionIdentityInput = {
  baseAccountId: 1,
  accountId: 2,
  date: "2026-04-03",
  narration: "MERCHANT ONE",
  withdrawal: 500,
  deposit: 0,
  sourceReference: null,
  sourceTransactionKey: null,
};

const groupedJournal: JournalCandidate = {
  id: 10,
  date: "2026-04-03",
  description: "Expenses",
  entries: [
    {
      id: 101,
      accountId: 2,
      debit: 500,
      credit: 0,
      comment: "MERCHANT ONE",
      sourceReference: null,
      sourceTransactionKey: null,
    },
    {
      id: 102,
      accountId: 3,
      debit: 700.25,
      credit: 0,
      comment: "MERCHANT TWO",
      sourceReference: null,
      sourceTransactionKey: null,
    },
    {
      id: 103,
      accountId: 1,
      debit: 0,
      credit: 1200.25,
      comment: null,
      sourceReference: null,
      sourceTransactionKey: null,
    },
  ],
};

describe("matchTransactionToJournal", () => {
  it("matches an itemized counterparty leg inside a grouped purchase journal", () => {
    expect(matchTransactionToJournal(purchase, groupedJournal)).toEqual([
      {
        matchType: "itemized-journal-leg",
        confidence: 0.95,
        journalId: 10,
        journalEntryId: 101,
      },
    ]);
  });

  it("matches a card payment with no counterparty through the base-account leg", () => {
    const payment = {
      ...purchase,
      accountId: null,
      narration: "PAYMENT RECEIVED - THANK YOU",
      withdrawal: 0,
      deposit: 3500.75,
    };
    const journal: JournalCandidate = {
      id: 20,
      date: payment.date,
      description: "Deposits",
      entries: [
        {
          id: 201,
          accountId: 1,
          debit: 3500.75,
          credit: 0,
          comment: null,
          sourceReference: null,
          sourceTransactionKey: null,
        },
        {
          id: 202,
          accountId: 4,
          debit: 0,
          credit: 3500.75,
          comment: "Transfer",
          sourceReference: null,
          sourceTransactionKey: null,
        },
      ],
    };
    expect(matchTransactionToJournal(payment, journal)[0]?.matchType).toBe(
      "base-account-payment",
    );
  });

  it("does not semantically match distinct keyed transactions", () => {
    const keyed = {
      ...groupedJournal,
      entries: groupedJournal.entries.map((entry, index) => ({
        ...entry,
        sourceTransactionKey: index === 0 ? "different-key" : null,
      })),
    };
    expect(
      matchTransactionToJournal(
        { ...purchase, sourceTransactionKey: "wanted-key" },
        keyed,
      ),
    ).toEqual([]);
  });
});
