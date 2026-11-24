"use client";

import Link from "next/link";
import { createContext, useContext, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";

export type Balance = { freeCredits: number; paidCredits: number };
type BalanceState = [Balance, Dispatch<SetStateAction<Balance>>];
const UploadBalance = createContext<BalanceState | null>(null);

export function UploadBalanceProvider({ initialBalance, children }: { initialBalance: Balance; children: ReactNode }) {
  const state = useState(initialBalance);
  return <UploadBalance.Provider value={state}>{children}</UploadBalance.Provider>;
}

export function useUploadBalance() {
  const state = useContext(UploadBalance);
  if (!state) throw new Error("Upload balance requires a signed-in account.");
  return state;
}

export function HeaderCreditBalance() {
  const [{ paidCredits, freeCredits }] = useUploadBalance();
  return (
    <Link href="/pricing" className="header-credit-balance">
      <span aria-live="polite">{paidCredits} {paidCredits === 1 ? "credit" : "credits"} left</span>
      {freeCredits > 0 && <small>{freeCredits} free {freeCredits === 1 ? "trial" : "trials"}</small>}
    </Link>
  );
}
