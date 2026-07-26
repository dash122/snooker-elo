import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentMember, listMembers } from "../../db/auth";
import { getState } from "../../db/state";
import MemberDirectory, { Avatar, type Member, type Player } from "./MemberDirectory";
import PlayerLinkCombobox from "./PlayerLinkCombobox";

export const dynamic = "force-dynamic";

const zh = {
  kicker: "管理員控制台", title: "會員管理",
  created: "帳戶已建立。", updated: "帳戶已更新。", linkedOne: "球員檔案已連結。",
  exists: "此電郵或使用者名稱已存在，或該球員檔案已被其他帳戶連結。",
  invalid: "請檢查帳戶資料。",
  statAccounts: "帳戶總數", statAdmins: "管理員", statUnlinked: "待連結球員檔案", statAllLinked: "全部已連結",
  attentionTitle: "需要處理", attentionSub: "以下帳戶未連結球員檔案，成績不會計入排行榜。選擇對應的球員即可連結。",
  link: "連結", pick: "選擇球員",
  addSection: "新增使用者", addSub: "預設會為新帳戶建立全新球員檔案；如該人已在排行榜上，請改為選擇其現有檔案。",
  name: "顯示名稱", username: "使用者名稱", email: "電郵", password: "密碼", role: "帳戶類型",
  member: "會員", admin: "管理員", player: "球員檔案", createNew: "建立新球員檔案",
  add: "新增帳戶", directorySection: "成員目錄", back: "返回我的帳戶",
};

type Search = { error?: string; created?: string; updated?: string; linked?: string; who?: string };

export default async function AdminPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await getCurrentMember();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/account");
  const [p, members, raw] = await Promise.all([searchParams, listMembers(), getState()]);
  const players: Player[] = raw ? (JSON.parse(raw) as { players?: Player[] }).players ?? [] : [];
  const linkedIds = new Set(players.map(player => player.id));
  const isLinked = (member: Member) => !!member.statePlayerId && linkedIds.has(member.statePlayerId);
  const unlinked = members.filter(member => member.active && !isLinked(member));
  const admins = members.filter(member => member.role === "admin").length;
  // Players nobody has claimed yet — the only sensible targets when linking, and
  // offering the full roster would just surface choices that fail the unique index.
  const claimed = new Set(members.map(member => member.statePlayerId).filter(Boolean) as string[]);
  const freePlayers = players.filter(player => !claimed.has(player.id));
  const note = (text: string) => p.who ? `${text.replace(/。$/, "")}：${p.who}` : text;

  return <main className="auth-page admin-page">
    <section className="auth-card admin-card">
      <Link className="auth-brand" href="/">SCAA <span>Snooker ELO</span></Link>
      <p className="kicker">{zh.kicker}</p>
      <h1>{zh.title}</h1>

      {p.created && <p className="form-success">{note(zh.created)}</p>}
      {p.updated && <p className="form-success">{note(zh.updated)}</p>}
      {p.linked && <p className="form-success">{note(zh.linkedOne)}</p>}
      {p.error && <p className="form-error">{p.error === "exists" ? zh.exists : zh.invalid}</p>}

      <div className="admin-stats">
        <div><small>{zh.statAccounts}</small><b>{members.length}</b></div>
        <div><small>{zh.statAdmins}</small><b>{admins}</b></div>
        <div className={unlinked.length ? "warn" : ""}>
          <small>{unlinked.length ? zh.statUnlinked : zh.statAllLinked}</small>
          <b>{unlinked.length || "✓"}</b>
        </div>
      </div>

      {unlinked.length > 0 && <section className="admin-attention">
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
              <button className="primary" type="submit">{zh.link}</button>
            </form>
          </div>)}
        </div>
      </section>}

      <details className="admin-section">
        <summary>{zh.addSection}</summary>
        <p className="admin-section-sub">{zh.addSub}</p>
        <form className="auth-form admin-create" data-player-link-form="create" action="/api/admin/members" method="post">
          <label>{zh.name}<input name="displayName" required minLength={2} /></label>
          <label>{zh.username}<input name="username" autoComplete="username" required minLength={2} /></label>
          <label>{zh.email}<input name="email" type="email" required /></label>
          <label>{zh.password}<input name="password" type="password" minLength={6} autoComplete="new-password" required /></label>
          <label>{zh.role}<select name="role"><option value="member">{zh.member}</option><option value="admin">{zh.admin}</option></select></label>
          <label>{zh.player}
            <PlayerLinkCombobox players={freePlayers} initialValue="" name="statePlayerId"
              formId="create" placeholder={zh.createNew} clearLabel={zh.createNew} />
          </label>
          <button className="primary" type="submit">{zh.add}</button>
        </form>
      </details>

      <section className="admin-section-open">
        <h2>{zh.directorySection}</h2>
        <MemberDirectory members={members} players={players} />
      </section>

      <Link className="more admin-back" href="/account">{zh.back}</Link>
    </section>
  </main>;
}
