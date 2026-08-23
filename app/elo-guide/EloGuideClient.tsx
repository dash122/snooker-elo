"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { calculateSnookerElo } from "../../lib/snooker-elo";

const workedExample = calculateSnookerElo({
  ratingA: 1600,
  ratingB: 1450,
  handicapA: -5,
  framesA: 5,
  framesB: 1,
  repetitionCount: 3,
  handicapEloScale: 1250,
});

function signed(value: number, digits = 0) {
  const rounded = digits ? value.toFixed(digits) : Math.round(value).toString();
  return `${value >= 0 ? "+" : ""}${rounded}`;
}

function pct(value: number) {
  return `${Math.round(value * 100)}%`;
}

function GuideMark() {
  return <span className="guide-mark" aria-hidden="true">S</span>;
}

function ParameterRow({ name, value, meaning }: { name: string; value: string; meaning: string }) {
  return <tr><th scope="row"><code>{name}</code></th><td className="parameter-value">{value}</td><td>{meaning}</td></tr>;
}

export default function EloGuideClient() {
  const [ratingA, setRatingA] = useState(1600);
  const [ratingB, setRatingB] = useState(1450);
  const [handicapA, setHandicapA] = useState(-5);
  const [framesA, setFramesA] = useState(5);
  const [framesB, setFramesB] = useState(1);

  const simulation = useMemo(() => calculateSnookerElo({
    ratingA,
    ratingB,
    handicapA,
    framesA,
    framesB,
    handicapEloScale: 1250,
  }), [ratingA, ratingB, handicapA, framesA, framesB]);

  const totalFrames = framesA + framesB;
  const expectedWidth = totalFrames ? `${Math.max(6, simulation.expectedFramesA / totalFrames * 100)}%` : "0%";
  const actualWidth = totalFrames ? `${Math.max(6, framesA / totalFrames * 100)}%` : "0%";
  const simulatedVerdict = totalFrames === 0
    ? "Record at least one frame to create rating evidence."
    : simulation.deltaA > 0.05
      ? `A performed above expectation and gains ${Math.abs(simulation.deltaA).toFixed(1)} ELO.`
      : simulation.deltaA < -0.05
        ? `A performed below expectation and gives back ${Math.abs(simulation.deltaA).toFixed(1)} ELO.`
        : "The result is close to the model's expectation, so the rating barely moves.";

  return <main className="elo-guide" lang="en">
    <header className="guide-nav">
      <Link className="guide-brand" href="/" aria-label="Back to SCAA Snooker ELO leaderboard">
        <GuideMark />
        <span><strong>SCAA</strong><small>Snooker ELO / field note</small></span>
      </Link>
      <nav aria-label="Guide navigation">
        <a href="#mechanism">The mechanism</a>
        <a href="#simulator">Simulator</a>
        <Link className="guide-nav-cta" href="/">Open the leaderboard <span aria-hidden="true">→</span></Link>
      </nav>
    </header>

    <section className="guide-hero" id="top">
      <div className="hero-copy">
        <p className="hero-label">A practical case note for business students</p>
        <h1>How a match becomes a rating.</h1>
        <p className="hero-deck">The club’s ELO is a forecasting system with memory. It does not simply reward a win; it prices the gap between what the model expected and what the frames actually delivered.</p>
        <div className="hero-actions"><a className="button button-light" href="#mechanism">Read the model <span aria-hidden="true">↓</span></a><a className="text-link" href="#simulator">Change the assumptions</a></div>
      </div>
      <div className="hero-brief" aria-label="The model in brief">
        <div className="brief-topline"><span>Decision memo</span><span>Model v14</span></div>
        <div className="brief-question">Did performance beat the forecast?</div>
        <div className="brief-flow"><span>ratings</span><i aria-hidden="true">+</i><span>handicap</span><i aria-hidden="true">+</i><span>frames</span><i aria-hidden="true">→</i><strong>new ELO</strong></div>
        <div className="brief-bottom"><span><b>1,500</b><small>default start</small></span><span><b>+41.0</b><small>worked example</small></span><span><b>0</b><small>separate result bonus</small></span></div>
      </div>
    </section>

    <section className="guide-intro guide-section">
      <div className="intro-lead"><h2>A rating is a forecast with memory.</h2><p>That framing is the key to reading every number that follows. A stronger player can still gain points for winning decisively, while a weaker player can gain more for outperforming the forecast. The scoreline is evidence; the rating is the running estimate.</p></div>
      <div className="intro-rail" role="list" aria-label="The three ideas behind the model"><div role="listitem"><span>Forecast</span><strong>Expected frames, not just expected wins.</strong></div><div role="listitem"><span>Evidence</span><strong>Longer matches carry more information.</strong></div><div role="listitem"><span>Memory</span><strong>Repeated pairings are damped for 30 days.</strong></div></div>
    </section>

    <section className="mechanism guide-section" id="mechanism">
      <div className="section-heading"><div><p className="section-label">The calculation spine</p><h2>Five decisions turn a score into a signal.</h2></div><p className="section-note">The app calculates Player A’s change. Player B receives the exact opposite change, keeping the two-player system zero-sum.</p></div>
      <ol className="process-list">
        <li><span className="process-index">1</span><div><h3>Set the starting position</h3><p>Each player enters the rating history at the stored <strong>initial rating</strong>, normally 1,500. Confirmed matches are replayed in date order.</p></div><code>R<sub>start</sub> = 1,500</code></li>
        <li><span className="process-index">2</span><div><h3>Estimate frame share</h3><p>Ratings and the applied handicap create a logistic forecast. A fair handicap remains 50/50; beyond a five-point residual soft zone, a symmetric quadratic tail makes excessive starts progressively more decisive.</p></div><code>P<sub>A</sub> = logistic(linear gap + excess-handicap tail)</code></li>
        <li><span className="process-index">3</span><div><h3>Translate probability into frames</h3><p>The forecast is multiplied by the total number of frames. A six-frame match asks a smaller question than a fifteen-frame match, but both are measured on the same frame-share logic.</p></div><code>E<sub>A</sub> = P<sub>A</sub> × n</code></li>
        <li><span className="process-index">4</span><div><h3>Price the evidence</h3><p>The actual frame percentage is compared with the forecast. Match length contributes only a diminishing confidence weight, so longer matches carry more evidence without inflating the performance gap itself.</p></div><code>performance = 300 × (actual share − forecast) × n/(n+5)</code></li>
        <li><span className="process-index">5</span><div><h3>Apply repetition decay</h3><p>If the same pairing met repeatedly in the preceding 30 days, the signal is discounted. At seven prior meetings, the default factor is 0.5.</p></div><code>ΔA = performance × 2<sup>−t/7</sup></code></li>
      </ol>
    </section>

    <section className="formula-section guide-section" aria-labelledby="formula-title">
      <div className="formula-intro"><p className="section-label">The model in one line</p><h2 id="formula-title">A good result is one that beats expectation.</h2><p>The production code has no separate K-factor and no extra win/loss bonus. The calculated performance score is the rating change.</p></div>
      <div className="formula-card"><div className="formula-main">ΔA = <span>300</span> × (actual frame share − expected frame share) × confidence × repetition factor</div><div className="formula-definitions"><span><b>confidence</b> = n / (n + 5)</span><span><b>actual frame share</b> = frames won / n</span><span><b>repetition factor</b> = 2<sup>−t/7</sup></span></div></div>
    </section>

    <section className="worked-example guide-section" aria-labelledby="example-title">
      <div className="example-score"><p className="section-label">Worked example</p><h2 id="example-title">One result, fully unpacked.</h2><div className="scoreboard"><div><span>Player A</span><strong>5</strong><small>1,600 ELO · gives 5</small></div><i aria-hidden="true">–</i><div><span>Player B</span><strong>1</strong><small>1,450 ELO</small></div></div><p className="example-caption">A strong player wins, but the handicap and the 30-day repetition history reduce how surprising the result is.</p></div>
      <div className="example-ledger"><div className="ledger-head"><span>Model input</span><span>Value</span><span>Why it matters</span></div><div className="ledger-row"><span>Expected frames for A</span><b>{workedExample.expectedFramesA.toFixed(2)}</b><small>Forecast before the match.</small></div><div className="ledger-row"><span>Actual frames for A</span><b>5.00</b><small>Observed performance.</small></div><div className="ledger-row"><span>Confidence weight</span><b>{workedExample.confidence.toFixed(3)}</b><small>Six frames provide partial evidence.</small></div><div className="ledger-row"><span>Repetition factor</span><b>{workedExample.repetitionFactor.toFixed(3)}</b><small>Three prior meetings in 30 days.</small></div><div className="ledger-row ledger-total"><span>Rating change for A</span><b>{signed(workedExample.deltaA, 2)} ELO</b><small>Player B moves by the opposite amount.</small></div></div>
    </section>

    <section className="simulator guide-section" id="simulator" aria-labelledby="simulator-title">
      <div className="section-heading"><div><p className="section-label">Try the assumptions</p><h2 id="simulator-title">Change the inputs. Watch the forecast move.</h2></div><p className="section-note">This uses the same production function as the app. In the handicap field, a negative number means Player A gives points; a positive number means A receives them.</p></div>
      <div className="simulator-grid">
        <div className="simulator-controls">
          <div className="control-group"><label htmlFor="rating-a">Player A rating <output>{ratingA}</output></label><input id="rating-a" type="range" min="1200" max="1900" step="10" value={ratingA} onChange={event => setRatingA(Number(event.target.value))} /></div>
          <div className="control-group"><label htmlFor="rating-b">Player B rating <output>{ratingB}</output></label><input id="rating-b" type="range" min="1200" max="1900" step="10" value={ratingB} onChange={event => setRatingB(Number(event.target.value))} /></div>
          <div className="control-group"><label htmlFor="handicap-a">Handicap applied to A <output>{handicapA > 0 ? "+" : ""}{handicapA}</output></label><input id="handicap-a" type="range" min="-15" max="15" step="1" value={handicapA} onChange={event => setHandicapA(Number(event.target.value))} /><small>−5 means A gives five points; +5 means A receives five.</small></div>
          <div className="score-controls"><div className="control-group"><label htmlFor="frames-a">A’s frames <output>{framesA}</output></label><input id="frames-a" type="range" min="0" max="15" step="1" value={framesA} onChange={event => setFramesA(Number(event.target.value))} /></div><div className="control-group"><label htmlFor="frames-b">B’s frames <output>{framesB}</output></label><input id="frames-b" type="range" min="0" max="15" step="1" value={framesB} onChange={event => setFramesB(Number(event.target.value))} /></div></div>
        </div>
        <div className="simulator-result"><div className="result-top"><div><span>Expected frame share for A</span><strong>{pct(simulation.probabilityA)}</strong></div><div className={simulation.deltaA >= 0 ? "result-positive" : "result-negative"}><span>Rating change for A</span><strong>{signed(simulation.deltaA, 1)}</strong><small>ELO</small></div></div><div className="frame-bars"><div className="bar-row"><span>Expected</span><div className="bar-track"><i style={{ width: expectedWidth }} /></div><b>{simulation.expectedFramesA.toFixed(2)}</b></div><div className="bar-row actual"><span>Actual</span><div className="bar-track"><i style={{ width: actualWidth }} /></div><b>{framesA.toFixed(2)}</b></div></div><p className="simulator-verdict">{simulatedVerdict}</p><div className="simulator-foot"><span>Performance sensitivity <b>{simulation.scale.toFixed(0)}</b></span><span>Confidence <b>{simulation.confidence.toFixed(3)}</b></span><span>Repetition factor <b>{simulation.repetitionFactor.toFixed(3)}</b></span></div></div>
      </div>
      <p className="display-note"><strong>Display note.</strong> The match form also shows win / draw / loss percentages by applying a binomial calculation to the frame probability. Those percentages help a player read the matchup; the rating update itself uses expected frames.</p>
    </section>

    <section className="guardrails guide-section" aria-labelledby="guardrails-title">
      <div className="guardrails-lead"><p className="section-label">Governance notes</p><h2 id="guardrails-title">Good systems make the exceptions legible.</h2><p>For a manager, the interesting part is not only the formula. It is the set of operating rules around the formula—the controls that keep a public rating credible.</p></div>
      <div className="guardrails-list"><article><span>Social mode</span><h3>2v2 entertainment matches are rating-neutral.</h3><p>The app records the score and the teams, but preserves every player’s official ELO, form, and record.</p></article><article><span>Audit trail</span><h3>Editing a match replays the history.</h3><p>Confirmed matches are rebuilt from each player’s initial rating in chronological order, so one corrected result can move later ratings too.</p></article><article><span>Early signal</span><h3>The first ten games stay provisional.</h3><p>New players are labelled provisional until they have enough observed evidence to read as a stable public number.</p></article><article><span>Fairness layer</span><h3>Handicap is a forecast adjustment, not a new rating.</h3><p>The recommended handicap cancels the rating gap at 50/50. Beyond a five-point residual soft zone, the forecast progressively penalises an excessive start to reflect snooker’s practical scoring ceiling.</p></article></div>
    </section>

    <section className="parameters guide-section" aria-labelledby="parameters-title">
      <div className="section-heading"><div><p className="section-label">Model settings</p><h2 id="parameters-title">The constants are policy choices.</h2></div><p className="section-note">The app keeps these values configurable. That makes the model auditable: a committee can debate the assumptions without rewriting the machinery.</p></div>
      <div className="parameter-table-wrap"><table><caption className="sr-only">Default SCAA Snooker ELO parameters</caption><thead><tr><th scope="col">Parameter</th><th scope="col">Default</th><th scope="col">Business interpretation</th></tr></thead><tbody><ParameterRow name="start" value="1,500" meaning="The neutral opening position for a new player." /><ParameterRow name="handicapPointsToElo" value="25" meaning="ELO points represented by one handicap point inside the linear region." /><ParameterRow name="excessHandicapSoftZone" value="5 points" meaning="Residual advantage allowed before the scoring-ceiling curve begins." /><ParameterRow name="excessHandicapCurveScale" value="26.5 points" meaning="Controls how quickly excessive handicaps become decisive." /><ParameterRow name="handicapEloScale" value="1,250" meaning="How quickly an ELO gap changes the frame forecast." /><ParameterRow name="frameScaleCoefficient" value="300" meaning="Sensitivity to the gap between actual and expected frame share." /><ParameterRow name="confidence" value="n/(n+5)" meaning="A diminishing evidence weight based on frames played." /><ParameterRow name="repetitionDecay" value="2, 7" meaning="The factor and half-life: seven prior meetings halves the signal." /><ParameterRow name="provisionalGames" value="10" meaning="The evidence threshold for a non-provisional label." /></tbody></table></div>
    </section>

    <footer className="guide-footer"><div><GuideMark /><p><strong>The takeaway</strong><br />ELO is not a prize for winning. It is a disciplined update to a forecast—large when the score surprises the model, smaller when the evidence is thin or repetitive.</p></div><Link className="button button-dark" href="/">Return to the live leaderboard <span aria-hidden="true">→</span></Link></footer>
  </main>;
}
