/*
 * Refer a friend (guardians and adult learners) — Growth Engine, owner decisions 22/11.
 * Link + code + share (mock: nothing is sent), link performance, the referrer's own leads,
 * the tuition-credit wallet (MOCK — nothing is charged or paid) and an anonymous leaderboard.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { MyReferrals } from "@ogc/contracts";
import { growth } from "../../lib/api";
import { useViewer } from "../../app/iiosGate";
import { formatCenterDate, formatCenterDateTime } from "../../lib/centerTime";
import { Button, Card, EmptyState, ErrorState, PageHeader, Spinner, StatTile } from "../../ui";
import { STATUS_LABEL, vnd } from "./format";

const TABS = ["Share & Earn", "My referrals", "Wallet", "Leaderboard"] as const;
type Tab = (typeof TABS)[number];

export function ReferralsPage() {
  const viewer = useViewer();
  const q = useQuery({ queryKey: ["growth-mine", viewer], queryFn: () => growth.getMine(viewer) });
  const [tab, setTab] = useState<Tab>("Share & Earn");
  if (q.isLoading) return <Spinner label="Loading referrals" />;
  if (q.isError)
    return <ErrorState message="Could not load referrals." onRetry={() => q.refetch()} />;
  if (!q.data)
    return (
      <EmptyState
        title="Referrals are for guardians and adult learners"
        hint="Learners under 18 do not have a referral link — their guardian can refer friends instead."
      />
    );
  const d = q.data;
  return (
    <section className="space-y-4">
      <PageHeader title="Refer a friend" subtitle="Referral program · synthetic demo" />
      {d.program.enabled ? null : (
        <p role="note" className="text-sm text-muted">
          The referral program is paused by your center.
        </p>
      )}
      <div role="tablist" aria-label="Referrals" className="flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={`px-3 py-2 text-sm ${tab === t ? "border-b-2 border-brand font-medium text-brand" : "text-muted"}`}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "Share & Earn" ? <Share d={d} /> : null}
      {tab === "My referrals" ? <Mine d={d} /> : null}
      {tab === "Wallet" ? <Wallet d={d} /> : null}
      {tab === "Leaderboard" ? <Board d={d} /> : null}
    </section>
  );
}

function CopyRow({ label, value, big = false }: { label: string; value: string; big?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-ogc border border-border p-3">
      <div>
        <p className="text-xs font-medium uppercase text-muted">{label}</p>
        <p
          className={big ? "font-mono text-2xl tracking-widest" : "break-all text-sm"}
          data-testid={label}
        >
          {value}
        </p>
      </div>
      <Button
        variant="ghost"
        aria-label={`Copy ${label}`}
        onClick={() => {
          void navigator.clipboard?.writeText(value).catch(() => undefined);
          setDone(true);
        }}
      >
        {done ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

function Share({ d }: { d: MyReferrals }) {
  const link = `${window.location.origin}${d.link}`;
  const [shared, setShared] = useState<string | null>(null);
  const p = d.performance;
  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <h2 className="font-medium">Your referral link</h2>
        <p className="text-sm text-muted">Share it with friends looking for an English course.</p>
        <CopyRow label="Your link" value={link} />
        <CopyRow label="Referral code" value={d.code} big />
        <div className="flex flex-wrap gap-2">
          {["Zalo", "Facebook", "Email"].map((ch) => (
            <Button
              key={ch}
              variant={ch === "Email" ? "ghost" : "primary"}
              onClick={() => setShared(ch)}
            >
              Share via {ch}
            </Button>
          ))}
        </div>
        {shared ? (
          <p role="status" className="text-sm text-muted">
            Demo: nothing was sent to {shared}. The message would read: “{d.shareText} {link}”
          </p>
        ) : null}
      </Card>
      <div className="grid gap-3 sm:grid-cols-4">
        <StatTile label="Clicks" value={String(p.clicks)} />
        <StatTile label="Leads" value={String(p.leads)} />
        <StatTile label="Conversions" value={String(p.conversions)} />
        <StatTile label="Conv. rate" value={p.convRatePct === null ? "—" : `${p.convRatePct}%`} />
      </div>
      <Card className="space-y-1 text-sm">
        <h2 className="font-medium">How the reward works</h2>
        <p>
          Earn <strong>{d.program.rewardPct}% of the first tuition payment</strong> as tuition
          credit when the family you referred enrols and pays, and the center confirms it.
        </p>
        <p>
          Maximum <strong>{vnd(d.program.capVnd)}</strong> per referral. Credit is applied to your
          next tuition invoice.
        </p>
        {d.program.campaigns
          .filter((c) => c.active)
          .map((c) => (
            <p key={c.id}>
              Campaign <strong>{c.name}</strong>: +{c.bonusPct}% for referrals through its link.
            </p>
          ))}
        <p className="text-xs text-muted">
          Demo only — no money is charged, paid or credited for real. Referring yourself or your own
          household does not count.
        </p>
      </Card>
    </div>
  );
}

function Mine({ d }: { d: MyReferrals }) {
  if (d.myLeads.length === 0)
    return (
      <EmptyState title="No referrals yet" hint="When a friend uses your link, they appear here." />
    );
  return (
    <ul className="space-y-2" aria-label="My referrals">
      {d.myLeads.map((l, i) => (
        <li key={i}>
          <Card className="flex flex-wrap justify-between gap-2 text-sm">
            <span className="font-medium">{l.learnerName}</span>
            <span>{STATUS_LABEL[l.status]}</span>
            <span className="text-muted">{formatCenterDate(l.createdAt)}</span>
          </Card>
        </li>
      ))}
    </ul>
  );
}

function Wallet({ d }: { d: MyReferrals }) {
  return (
    <div className="space-y-3">
      <Card>
        <p className="text-xs uppercase text-muted">Tuition credit balance (mock)</p>
        <p className="text-3xl font-semibold" data-testid="wallet-balance">
          {vnd(d.wallet.balanceVnd)}
        </p>
        <p className="text-xs text-muted">
          Applied to your next tuition invoice. Nothing is paid out.
        </p>
      </Card>
      {d.wallet.entries.length === 0 ? (
        <EmptyState title="No credit yet" />
      ) : (
        <ul className="space-y-2" aria-label="Wallet entries">
          {d.wallet.entries.map((e) => (
            <li key={e.id}>
              <Card className="flex flex-wrap justify-between gap-2 text-sm">
                <span>{e.note}</span>
                <span className="font-medium">+{vnd(e.amountVnd)}</span>
                <span className="text-xs text-muted">{formatCenterDateTime(e.at)}</span>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Board({ d }: { d: MyReferrals }) {
  return (
    <Card>
      <p className="mb-2 text-xs text-muted">
        Confirmed referrals in your organization. Other referrers stay anonymous.
      </p>
      <ol className="space-y-1 text-sm" aria-label="Referral leaderboard">
        {d.leaderboard.map((r) => (
          <li
            key={r.rank}
            className={`flex justify-between ${r.you ? "font-medium text-brand" : ""}`}
          >
            <span>
              #{r.rank} {r.label}
            </span>
            <span>{r.conversions} confirmed</span>
          </li>
        ))}
      </ol>
    </Card>
  );
}
