"use client";

import { useMemo, useRef, useState } from "react";
import { resolveInitials } from "../api/account/validate";
import PlayerLinkCombobox from "./PlayerLinkCombobox";
import { Button, EmptyState } from "../components/ui/Primitives";
import { ConfirmDialog, Sheet } from "../components/ui/Overlay";

export type Player = { id: string; name: string; active?: boolean };
export type Member = {
  email: string; username: string; displayName: string; statePlayerId?: string;
  avatar?: string | null; initials?: string | null; role: "admin" | "member"; active: boolean;
};

const PAGE_SIZE = 25;

const zh = {
  prev: "上一頁", next: "下一頁", pageOf: (page: number, pages: number) => `第 ${page} / ${pages} 頁`,
  search: "搜尋姓名、使用者名稱或電郵", searchLabel: "搜尋帳戶",
  all: "全部", admins: "管理員", unlinked: "未連結", inactive: "已停用",
  noMatch: "找不到符合的帳戶", noMatchSub: "試試其他姓名、使用者名稱或電郵。",
  count: (shown: number, total: number) => shown === total ? `${total} 個帳戶` : `${shown} / ${total} 個帳戶`,
  colMember: "成員", colPlayer: "球員檔案",
  name: "顯示名稱", username: "使用者名稱", email: "電郵",
  role: "帳戶類型", advanced: "進階設定",
  rolePassword: "確認角色變更的管理員密碼", rolePasswordHint: "只有更改會員／管理員身份時需要重新輸入。",
  password: "新密碼", passwordHint: "留空則不更改密碼。",
  player: "連結球員檔案", none: "未連結",
  member: "會員", admin: "管理員",
  save: "儲存變更", editLabel: (name: string) => `編輯 ${name}`,
  deleteAccount: "刪除帳戶", deleteConfirm: (name: string) =>
    `確定要刪除「${name}」的帳戶及其球員檔案嗎？此動作無法復原，若該球員已有比賽紀錄則無法刪除。`,
};

export function Avatar({ member, playerName }: { member: Member; playerName?: string | null }) {
  const initials = resolveInitials(member, playerName ? { name: playerName } : null);
  return member.avatar
    // eslint-disable-next-line @next/next/no-img-element -- data URI, no loader needed
    ? <img className="admin-avatar" src={member.avatar} alt="" />
    : <span className="admin-avatar" aria-hidden="true">{initials}</span>;
}

/**
 * The admin's most frequent job is "find one person and fix their account". The list is therefore a plain
 * table you scan and search (name, linked player, status) and nothing more; every edit happens in one
 * sheet that shows the four everyday fields and tucks role, password and delete under "advanced".
 */
export default function MemberDirectory({ members, players, currentEmail }: { members: Member[]; players: Player[]; currentEmail: string }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "admins" | "unlinked">("all");
  const [page, setPage] = useState(0);
  const [editingEmail, setEditingEmail] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ form: HTMLFormElement; name: string } | null>(null);
  const skipDeleteConfirm = useRef(false);
  const playerName = useMemo(() => new Map(players.map(player => [player.id, player.name])), [players]);
  const linkOf = (member: Member) => (member.statePlayerId && playerName.get(member.statePlayerId)) || null;

  const shown = (() => {
    const q = query.trim().toLowerCase();
    return members.filter(member => {
      if (filter === "admins" && member.role !== "admin") return false;
      if (filter === "unlinked" && linkOf(member)) return false;
      if (!q) return true;
      return [member.displayName, member.username, member.email].some(field => field.toLowerCase().includes(q));
    });
  })();
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const visible = shown.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);

  const unlinkedCount = members.filter(member => !linkOf(member)).length;
  const adminCount = members.filter(member => member.role === "admin").length;
  const chips = [
    { id: "all" as const, label: zh.all, count: members.length },
    { id: "admins" as const, label: zh.admins, count: adminCount },
    { id: "unlinked" as const, label: zh.unlinked, count: unlinkedCount },
  ];
  const editing = members.find(member => member.email === editingEmail) ?? null;

  return <div className="admin-directory">
    <div className="admin-directory-controls">
      <input className="admin-search" type="search" value={query} aria-label={zh.searchLabel} placeholder={zh.search}
        onChange={event => { setQuery(event.target.value); setPage(0); }} />
      <div className="admin-chips" role="group" aria-label={zh.searchLabel}>
        {chips.map(chip => <button key={chip.id} type="button" aria-pressed={filter === chip.id}
          className={`admin-chip${filter === chip.id ? " active" : ""}${chip.id === "unlinked" && chip.count > 0 ? " warn" : ""}`}
          onClick={() => { setFilter(chip.id); setPage(0); }}>{chip.label}<em>{chip.count}</em></button>)}
      </div>
    </div>
    <p className="admin-directory-count">{zh.count(shown.length, members.length)}</p>
    {shown.length === 0
      ? <EmptyState title={zh.noMatch} description={zh.noMatchSub} />
      : <div className="admin-table">
        <div className="admin-table-head" aria-hidden="true"><span>{zh.colMember}</span><span>{zh.colPlayer}</span></div>
        <ul>{visible.map(member => {
          const link = linkOf(member);
          return <li key={member.email} className={member.active ? "" : "is-inactive"}>
            <button type="button" className="admin-table-row" aria-label={zh.editLabel(member.displayName)} onClick={() => setEditingEmail(member.email)}>
              <Avatar member={member} playerName={link} />
              <span className="admin-row-id"><b>{member.displayName}</b><small>@{member.username}</small></span>
              <span className={`admin-cell-player${link ? "" : " is-missing"}`}>{link ?? `⚠ ${zh.none}`}</span>
              <span className="admin-row-tags">
                {!member.active && <em className="admin-tag inactive">{zh.inactive}</em>}
                {member.role === "admin" && <em className="admin-tag role">{zh.admin}</em>}
              </span>
              <span className="admin-row-chevron" aria-hidden="true">›</span>
            </button>
          </li>;
        })}</ul>
      </div>}
    {pages > 1 && <nav className="admin-pager" aria-label={zh.searchLabel}>
      <Button variant="secondary" disabled={current === 0} onClick={() => setPage(current - 1)}>{zh.prev}</Button>
      <span>{zh.pageOf(current + 1, pages)}</span>
      <Button variant="secondary" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>{zh.next}</Button>
    </nav>}

    <Sheet open={Boolean(editing)} title={editing?.displayName ?? ""} onClose={() => setEditingEmail(null)}>
      {editing && <>
        <p className="admin-sheet-sub">{editing.email}</p>
        <form className="auth-form admin-sheet-form" data-player-link-form={`edit:${editing.email}`} action="/api/admin/members" method="post">
          <input type="hidden" name="action" value="update" />
          <input type="hidden" name="originalEmail" value={editing.email} />
          <label>{zh.name}<input name="displayName" defaultValue={editing.displayName} required minLength={2} /></label>
          <label>{zh.username}<input name="username" defaultValue={editing.username} required minLength={2} /></label>
          <label>{zh.email}<input name="email" type="email" defaultValue={editing.email} required /></label>
          <label>{zh.player}
            <PlayerLinkCombobox players={players} initialValue={editing.statePlayerId && playerName.has(editing.statePlayerId) ? editing.statePlayerId : ""}
              name="statePlayerId" formId={`edit:${editing.email}`} placeholder={zh.none} clearLabel={zh.none} />
          </label>
          <details className="admin-advanced">
            <summary>{zh.advanced}</summary>
            <label>{zh.role}<select name="role" defaultValue={editing.role} onChange={event => {
              const confirmation = event.currentTarget.form?.elements.namedItem("roleConfirmationPassword");
              if (confirmation instanceof HTMLInputElement) {
                const changed = event.currentTarget.value !== editing.role;
                confirmation.required = changed;
                confirmation.setAttribute("aria-required", String(changed));
              }
            }}><option value="member">{zh.member}</option><option value="admin">{zh.admin}</option></select></label>
            <label>{zh.rolePassword}<input name="roleConfirmationPassword" type="password" autoComplete="current-password" />
              <small className="admin-field-hint">{zh.rolePasswordHint}</small></label>
            <label>{zh.password}<input name="password" type="password" minLength={6} autoComplete="new-password" />
              <small className="admin-field-hint">{zh.passwordHint}</small></label>
          </details>
          <Button type="submit">{zh.save}</Button>
        </form>
        {editing.email !== currentEmail && <form className="admin-delete" action="/api/admin/members" method="post"
          onSubmit={event => {
            if (skipDeleteConfirm.current) { skipDeleteConfirm.current = false; return; }
            event.preventDefault();
            setPendingDelete({ form: event.currentTarget, name: editing.displayName });
          }}>
          <input type="hidden" name="action" value="delete" />
          <input type="hidden" name="originalEmail" value={editing.email} />
          <Button variant="quiet" className="admin-delete-link" type="submit">{zh.deleteAccount}</Button>
        </form>}
      </>}
    </Sheet>

    {pendingDelete && <ConfirmDialog kicker={zh.deleteAccount} titleId="delete-member-title" title={`確定要刪除「${pendingDelete.name}」的帳戶？`} description={zh.deleteConfirm(pendingDelete.name)} onClose={() => setPendingDelete(null)}>
      <Button variant="secondary" onClick={() => setPendingDelete(null)}>取消</Button>
      <Button variant="danger" onClick={() => { const { form } = pendingDelete; setPendingDelete(null); skipDeleteConfirm.current = true; form.requestSubmit(); }}>{zh.deleteAccount}</Button>
    </ConfirmDialog>}
  </div>;
}
