import Link from "next/link";
import { BrandLogo } from "../components/BrandLogo";
import { redirect } from "next/navigation";
import { getCurrentMember, listMembers } from "../../db/auth";
import { listAdminPlayers, listSnapshots } from "../../db/state";
import MemberDirectory, { Avatar, type Member } from "./MemberDirectory";
import PlayerLinkCombobox from "./PlayerLinkCombobox";
import SnapshotList from "./SnapshotList";
import { Button, StatTile, Surface } from "../components/ui/Primitives";

export const dynamic = "force-dynamic";

const zh = {
  kicker: "管理員控制台", title: "會員管理",
  created: "帳戶已建立。", updated: "帳戶已更新。", linkedOne: "球員檔案已連結。",
  deleted: "帳戶及球員檔案已刪除。",
  exists: "此電郵或使用者名稱已存在，或該球員檔案已被其他帳戶連結。",
  invalid: "請檢查帳戶資料。",
  selfDelete: "無法刪除您目前登入的帳戶。",
  lastAdmin: "至少需要保留一位管理員帳戶。",
  rolePassword: "更改帳戶類型需要重新輸入正確的管理員密碼。",
  hasMatches: "此球員已有比賽紀錄，無法刪除檔案。請先停用帳戶，或移除相關賽事後再試。",
  restored: "資料已還原至所選快照。",
  snapshotsSection: "資料備份快照", snapshotsSub: "系統每小時最多保留一個完整資料備份，最多保留 100 個；此頁顯示最近 20 個。還原會以該時間點的資料覆蓋目前所有資料。",
  snapshotsEmpty: "暫無備份快照。", restore: "還原",
  settings: "ELO 設定", playersOpen: "管理球員及個人起始 ELO", reportsOpen: "使用統計報告", statAccounts: "帳戶總數", statAdmins: "管理員", statUnlinked: "待連結球員檔案", statAllLinked: "全部已連結",
  statNoAccount: "球員待開帳戶", statAllHaveAccounts: "球員全部已開帳戶",
  attentionTitle: "需要處理", attentionSub: "以下帳戶未連結球員檔案，成績不會計入排行榜。選擇對應的球員即可連結。",
  link: "連結", pick: "選擇球員",
  noAccountTitle: "球員未有帳戶", noAccountSub: "以下球員已在排行榜上，但仍未有登入帳戶，無法自行查看成績或更新資料。",
  createAccount: "建立帳戶", noAccountEmpty: "所有球員都已有對應帳戶。",
  prefillNote: (name: string) => `正在為球員「${name}」建立帳戶，該球員檔案會自動連結。`,
  addSection: "新增使用者", addSub: "預設會為新帳戶建立全新球員檔案；如該人已在排行榜上，請改為選擇其現有檔案。",
  name: "顯示名稱", username: "使用者名稱", email: "電郵", password: "密碼", role: "帳戶類型",
  member: "會員", admin: "管理員", player: "球員檔案", createNew: "建立新球員檔案",
  add: "新增帳戶", directorySection: "成員目錄", back: "返回我的帳戶",
};

type Search = { error?: string; created?: string; updated?: string; linked?: string; deleted?: string; restored?: string; who?: string; player?: string };

export default async function AdminPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await getCurrentMember();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/account");
  const [p, members, players, snapshots] = await Promise.all([searchParams, listMembers(), listAdminPlayers(), listSnapshots(20)]);
  const linkedIds = new Set(players.map(player => player.id));
  const isLinked = (member: Member) => !!member.statePlayerId && linkedIds.has(member.statePlayerId);
  const unlinked = members.filter(member => member.active && !isLinked(member));
  const admins = members.filter(member => member.role === "admin").length;
  // Players nobody has claimed yet — the only sensible targets when linking, and
  // offering the full roster would just surface choices that fail the unique index.
  const claimed = new Set(members.map(member => member.statePlayerId).filter(Boolean) as string[]);
  const freePlayers = players.filter(player => !claimed.has(player.id));
  // The mirror of an unlinked account: a player who competes but has no login.
  // Retired players are excluded — nobody needs an account created for them.
  const needAccount = freePlayers.filter(player => player.active !== false);
  // Clicking "create account" on such a player prefills the form below, so the
  // admin doesn't have to retype the name and re-find the profile in the picker.
  const prefill = p.player ? freePlayers.find(player => player.id === p.player) : undefined;
  const note = (text: string) => p.who ? `${text.replace(/。$/, "")}：${p.who}` : text;

  return <main className="auth-page admin-page">
    <section className="auth-card admin-card">
      <BrandLogo className="auth-brand"/>
      <p className="kicker">{zh.kicker}</p>
      <h1>{zh.title}</h1>

      {p.created && <p className="form-success">{note(zh.created)}</p>}
      {p.updated && <p className="form-success">{note(zh.updated)}</p>}
      {p.linked && <p className="form-success">{note(zh.linkedOne)}</p>}
      {p.deleted && <p className="form-success">{note(zh.deleted)}</p>}
      {p.restored && <p className="form-success">{zh.restored}</p>}
      {p.error && <p className="form-error">
        {p.error === "exists" ? zh.exists
          : p.error === "self-delete" ? zh.selfDelete
          : p.error === "last-admin" ? zh.lastAdmin
          : p.error === "role-password" ? zh.rolePassword
          : p.error === "has-matches" ? zh.hasMatches
          : zh.invalid}
      </p>}

      <div className="admin-stats">
        <StatTile label={zh.statAccounts} value={members.length} />
        <StatTile label={zh.statAdmins} value={admins} />
        <StatTile className={unlinked.length ? "warn" : ""}
          label={unlinked.length ? zh.statUnlinked : zh.statAllLinked}
          value={unlinked.length || "✓"} />
        <StatTile className={needAccount.length ? "warn" : ""}
          label={needAccount.length ? zh.statNoAccount : zh.statAllHaveAccounts}
          value={needAccount.length || "✓"} />
      </div>

      <div className="admin-toolbar">
        <Link className="primary" href="/?tab=players&manage=1">{zh.playersOpen}</Link>
        <a className="primary" href="/admin/reports">{zh.reportsOpen}</a>
      </div>

      {unlinked.length > 0 && <Surface className="admin-attention">
        <h2>{zh.attentionTitle}<em>{unlinked.length}</em></h2>
        <p>{zh.attentionSub}</p>
        <div className="member-list">{unlinked.map(member =>
          <div key={member.email} className="admin-unlinked-row">
            <Avatar member={member} />
            <span className="admin-row-id"><b>{member.displayName}</b><small>@{member.username} · {member.email}</small></span>
            <form className="admin-link" data-player-link-form={`link:${member.email}`} action="/api/admin/members" method="post">
              <input type="hidden" name="action" value="link" />
              <input type="hidden" name="originalEmail" value={member.email} />
              <PlayerLinkCombobox players={freePlayers} initialValue="" name="statePlayerId"
                formId={`link:${member.email}`} placeholder={zh.pick} clearLabel={zh.pick} />
              <Button type="submit">{zh.link}</Button>
            </form>
          </div>)}
        </div>
      </Surface>}

      {needAccount.length > 0 && <Surface className="admin-attention players">
        <h2>{zh.noAccountTitle}<em>{needAccount.length}</em></h2>
        <p>{zh.noAccountSub}</p>
        <ul className="admin-player-list">{needAccount.map(player =>
          <li key={player.id}>
            <span className="admin-avatar" aria-hidden="true">{player.name.slice(0, 2).toUpperCase()}</span>
            <b>{player.name}</b>
            <Link className="more" href={`/admin?player=${encodeURIComponent(player.id)}#create`}>{zh.createAccount}</Link>
          </li>)}
        </ul>
      </Surface>}

      <details className="admin-section" id="create" open={!!prefill}>
        <summary>{zh.addSection}</summary>
        <p className="admin-section-sub">{prefill ? zh.prefillNote(prefill.name) : zh.addSub}</p>
        <form className="auth-form admin-create" data-player-link-form="create" action="/api/admin/members" method="post">
          <label>{zh.name}<input name="displayName" defaultValue={prefill?.name ?? ""} required minLength={2} /></label>
          <label>{zh.username}<input name="username" autoComplete="username" required minLength={2} /></label>
          <label>{zh.email}<input name="email" type="email" required /></label>
          <label>{zh.password}<input name="password" type="password" minLength={6} autoComplete="new-password" required /></label>
          <label>{zh.role}<select name="role"><option value="member">{zh.member}</option><option value="admin">{zh.admin}</option></select></label>
          <label>{zh.player}
            <PlayerLinkCombobox players={freePlayers} initialValue={prefill?.id ?? ""} name="statePlayerId"
              formId="create" placeholder={zh.createNew} clearLabel={zh.createNew} />
          </label>
          <Button type="submit">{zh.add}</Button>
        </form>
      </details>

      <section className="admin-section-open">
        <h2>{zh.directorySection}</h2>
        <MemberDirectory members={members} players={players} currentEmail={user.email} />
      </section>

      <details className="admin-section">
        <summary>{zh.snapshotsSection}</summary>
        <p className="admin-section-sub">{zh.snapshotsSub}</p>
        {snapshots.length === 0
          ? <p className="admin-section-sub">{zh.snapshotsEmpty}</p>
          : <SnapshotList snapshots={snapshots} restoreLabel={zh.restore} confirmMessage="確定要以此快照覆蓋目前所有資料嗎？此操作無法復原。" />}
      </details>

      <a className="more admin-back" href="/account">{zh.back}</a>
    </section>
  </main>;
}
