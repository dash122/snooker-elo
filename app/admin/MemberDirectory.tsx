"use client";

import { useMemo, useRef, useState } from "react";
import { resolveInitials } from "../api/account/validate";
import PlayerLinkCombobox from "./PlayerLinkCombobox";
import { Button, EmptyState } from "../components/ui/Primitives";
import { ConfirmDialog } from "../components/ui/Overlay";

export type Player = { id: string; name: string; active?: boolean };
export type Member = {
  email: string; username: string; displayName: string; statePlayerId?: string;
  avatar?: string | null; initials?: string | null; role: "admin" | "member"; active: boolean;
};

const zh = {
  search: "搜尋姓名、使用者名稱或電郵", searchLabel: "搜尋帳戶",
  all: "全部", admins: "管理員", unlinked: "未連結", inactive: "已停用",
  noMatch: "找不到符合的帳戶", noMatchSub: "試試其他姓名、使用者名稱或電郵。",
  count: (shown: number, total: number) => shown === total ? `${total} 個帳戶` : `${shown} / ${total} 個帳戶`,
  basics: "基本資料", profile: "球員檔案", security: "安全性",
  name: "顯示名稱", username: "使用者名稱", email: "電郵",
  role: "帳戶類型",
  rolePassword: "確認角色變更的管理員密碼", rolePasswordHint: "只有更改會員／管理員身份時需要重新輸入。",
  password: "新密碼", passwordHint: "留空則不更改密碼。",
  player: "連結球員檔案", none: "未連結", linked: "已連結",
  member: "會員", admin: "管理員",
  save: "儲存變更", cancel: "還原",
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
 * The admin's most frequent job is "find one person and fix their account", so
 * the directory leads with search rather than a flat scroll. Each collapsed row
 * answers the questions an admin would otherwise have to expand to see: which
 * player profile is linked, and whether the account is an admin or deactivated.
 */
export default function MemberDirectory({ members, players, currentEmail }: { members: Member[]; players: Player[]; currentEmail: string }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "admins" | "unlinked">("all");
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

  const unlinkedCount = members.filter(member => !linkOf(member)).length;
  const adminCount = members.filter(member => member.role === "admin").length;
  const chips = [
    { id: "all" as const, label: zh.all, count: members.length },
    { id: "admins" as const, label: zh.admins, count: adminCount },
    { id: "unlinked" as const, label: zh.unlinked, count: unlinkedCount },
  ];

  return <div className="admin-directory">
    <div className="admin-directory-controls">
      <input className="admin-search" type="search" value={query} aria-label={zh.searchLabel} placeholder={zh.search}
        onChange={event => setQuery(event.target.value)} />
      <div className="admin-chips" role="group" aria-label={zh.searchLabel}>
        {chips.map(chip => <button key={chip.id} type="button" aria-pressed={filter === chip.id}
          className={`admin-chip${filter === chip.id ? " active" : ""}${chip.id === "unlinked" && chip.count > 0 ? " warn" : ""}`}
          onClick={() => setFilter(chip.id)}>{chip.label}<em>{chip.count}</em></button>)}
      </div>
    </div>
    <p className="admin-directory-count">{zh.count(shown.length, members.length)}</p>
    {shown.length === 0
      ? <EmptyState title={zh.noMatch} description={zh.noMatchSub} />
      : <div className="member-list">{shown.map(member => {
        const link = linkOf(member);
        return <details key={member.email} className={member.active ? "" : "is-inactive"}>
          <summary>
            <Avatar member={member} playerName={link} />
            <span className="admin-row-id"><b>{member.displayName}</b><small>@{member.username} · {member.email}</small></span>
            <span className="admin-row-tags">
              {!member.active && <em className="admin-tag inactive">{zh.inactive}</em>}
              {member.role === "admin" && <em className="admin-tag role">{zh.admin}</em>}
              <em className={`admin-tag ${link ? "linked" : "unlinked"}`} title={link ? `${zh.linked}：${link}` : zh.none}>
                {link ? <>● {link}</> : <>⚠ {zh.none}</>}
              </em>
            </span>
          </summary>
          <form className="auth-form admin-edit" data-player-link-form={`edit:${member.email}`} action="/api/admin/members" method="post">
            <input type="hidden" name="action" value="update" />
            <input type="hidden" name="originalEmail" value={member.email} />
            <p className="admin-field-group">{zh.basics}</p>
            <label>{zh.name}<input name="displayName" defaultValue={member.displayName} required minLength={2} /></label>
            <label>{zh.username}<input name="username" defaultValue={member.username} required minLength={2} /></label>
            <label className="admin-field-wide">{zh.email}<input name="email" type="email" defaultValue={member.email} required /></label>
            <p className="admin-field-group">{zh.profile}</p>
            <label className="admin-field-wide">{zh.player}
              <PlayerLinkCombobox players={players} initialValue={member.statePlayerId && playerName.has(member.statePlayerId) ? member.statePlayerId : ""}
                name="statePlayerId" formId={`edit:${member.email}`} placeholder={zh.none} clearLabel={zh.none} />
            </label>
            <p className="admin-field-group">{zh.security}</p>
            <label>{zh.role}<select name="role" defaultValue={member.role} onChange={event => {
              const confirmation = event.currentTarget.form?.elements.namedItem("roleConfirmationPassword");
              if (confirmation instanceof HTMLInputElement) {
                const changed = event.currentTarget.value !== member.role;
                confirmation.required = changed;
                confirmation.setAttribute("aria-required", String(changed));
              }
            }}><option value="member">{zh.member}</option><option value="admin">{zh.admin}</option></select></label>
            <label>{zh.rolePassword}<input name="roleConfirmationPassword" type="password" autoComplete="current-password" />
              <small className="admin-field-hint">{zh.rolePasswordHint}</small></label>
            <label className="admin-field-wide">{zh.password}<input name="password" type="password" minLength={6} autoComplete="new-password" />
              <small className="admin-field-hint">{zh.passwordHint}</small></label>
            <div className="admin-edit-actions">
              <Button type="submit">{zh.save}</Button>
              <Button variant="quiet" type="reset">{zh.cancel}</Button>
            </div>
          </form>
          {member.email !== currentEmail && <form className="admin-delete" action="/api/admin/members" method="post"
            onSubmit={event => {
              if (skipDeleteConfirm.current) { skipDeleteConfirm.current = false; return; }
              event.preventDefault();
              setPendingDelete({ form: event.currentTarget, name: member.displayName });
            }}>
            <input type="hidden" name="action" value="delete" />
            <input type="hidden" name="originalEmail" value={member.email} />
            <Button variant="danger" type="submit">{zh.deleteAccount}</Button>
          </form>}
        </details>;
      })}</div>}
    {pendingDelete && <ConfirmDialog kicker={zh.deleteAccount} titleId="delete-member-title" title={`確定要刪除「${pendingDelete.name}」的帳戶？`} description={zh.deleteConfirm(pendingDelete.name)} onClose={() => setPendingDelete(null)}>
      <Button variant="secondary" onClick={() => setPendingDelete(null)}>取消</Button>
      <Button variant="danger" onClick={() => { const { form } = pendingDelete; setPendingDelete(null); skipDeleteConfirm.current = true; form.requestSubmit(); }}>{zh.deleteAccount}</Button>
    </ConfirmDialog>}
  </div>;
}
