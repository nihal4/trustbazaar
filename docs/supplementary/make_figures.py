"""Figures for Section 1 (Bikroy history). Every number is hard-coded from a cited
source; the source key (matching the LaTeX bibliography) is noted next to each value."""
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from pathlib import Path

OUT = Path(__file__).parent / "figs"
OUT.mkdir(exist_ok=True)

INK, MUTED, GRID = "#1f2937", "#6b7280", "#e5e7eb"
UP, DOWN, NEUTRAL = "#2563eb", "#dc2626", "#9ca3af"

plt.rcParams.update({
    "font.family": "DejaVu Sans", "font.size": 9, "axes.edgecolor": MUTED,
    "axes.labelcolor": INK, "xtick.color": INK, "ytick.color": INK,
    "axes.spines.top": False, "axes.spines.right": False,
    "axes.grid": True, "grid.color": GRID, "grid.linewidth": 0.6,
    "axes.axisbelow": True, "savefig.bbox": "tight", "savefig.dpi": 300,
})

def save(fig, name):
    fig.savefig(OUT / f"{name}.pdf")
    fig.savefig(OUT / f"{name}.png")
    plt.close(fig)

# ---------------------------------------------------------------- Fig 1 timeline
events = [  # (decimal year, label, phase, level, h-align, source key)
    (2012.42, "Starts operating (Jun)", "up", 1.0, "center", "wiki_bikroy"),
    (2012.80, "Formal launch, Dhaka (18 Oct)", "up", -1.0, "center", "wiki_bikroy"),
    (2013.5,  "4th most-searched keyword\non Google in Bangladesh", "up", 2.2, "center", "wiki_bikroy"),
    (2014.46, "32 lakh ads in 2 years;\n8th largest local site", "up", -2.2, "center", "bn24_2014"),
    (2017.15, "Mandatory SMS-OTP\nfor ad posters", "neutral", 1.4, "center", "fs_fraud"),
    (2017.37, "Rival Ekhanei shuts down", "up", -1.0, "center", "fs_ekhanei"),
    (2019.6,  "Operating break-even (Aug)", "up", 2.4, "center", "wiki_bikroy"),
    (2022.5,  "Saltside sells Ghana\nunit (Tonaton) to Jiji", "down", -1.0, "center", "fs_jiji"),
    (2024.7,  "Saltside HQ down\nto 13 staff (Sep)", "down", 2.6, "right", "fs_jiji"),
    (2025.07, "Kinnevik (45%) seeks\nto sell stake (Jan)", "down", -2.2, "right", "fs_jiji"),
    (2025.23, "Jiji enters Bangladesh\nas competitor (Mar)", "down", 1.2, "left", "intellinews"),
    (2026.36, "Jiji acquires\nBikroy (May)", "down", -3.2, "center", "ds_jiji"),
]
col = {"up": UP, "down": DOWN, "neutral": NEUTRAL}
fig, ax = plt.subplots(figsize=(7.2, 3.6))
ax.axhline(0, color=MUTED, lw=1.2, zorder=1)
ax.axvspan(2012.3, 2019.8, color=UP, alpha=0.05, lw=0)
ax.axvspan(2021.9, 2026.9, color=DOWN, alpha=0.05, lw=0)
ax.text(2016.0, 3.55, "Growth & dominance", ha="center", color=UP, fontsize=9, weight="bold")
ax.text(2021.95, 3.55, "Disinvestment & sale", ha="left", color=DOWN, fontsize=9, weight="bold")
for x, label, ph, y, ha, _ in events:
    ax.vlines(x, 0, y, color=col[ph], lw=0.9, zorder=2)
    ax.scatter([x], [0], s=22, color=col[ph], zorder=3)
    dx = {"center": 0, "right": 0.06, "left": -0.06}[ha]
    ax.text(x + dx, y + (0.12 if y > 0 else -0.12), label,
            ha=ha, va="bottom" if y > 0 else "top", fontsize=6.8, color=INK)
ax.set_xlim(2011.6, 2027.2); ax.set_ylim(-4.2, 4.0)
ax.set_yticks([]); ax.spines["left"].set_visible(False); ax.grid(False)
ax.set_xticks(range(2012, 2027, 2))
save(fig, "fig1_timeline")

# ---------------------------------------------- Fig 2 early growth (2012-2014)
fig, (a, b) = plt.subplots(1, 2, figsize=(7.2, 2.7))
q_lab = ["Jun–Aug 2012\n(first 3 months)", "Mar–May 2014"]
q_val = [26_000, 827_000]                       # bn24_2014
bars = a.bar(q_lab, q_val, color=[NEUTRAL, UP], width=0.55)
for r, v in zip(bars, q_val):
    a.text(r.get_x() + r.get_width()/2, v, f"{v:,}", ha="center", va="bottom", fontsize=8)
a.set_ylabel("Ads posted per quarter")
a.set_title("(a) Ads per quarter: ~32× in two years", fontsize=9, loc="left")
a.yaxis.set_major_formatter(matplotlib.ticker.FuncFormatter(lambda x, _: f"{x/1e3:.0f}k"))
a.set_ylim(0, 950_000)

d_lab = ["Mid-2013", "Mid-2014"]
d_val = [3_000, 9_000]                          # bn24_2014 (9,000+ "now", 3,000 "a year ago")
bars = b.bar(d_lab, d_val, color=[NEUTRAL, UP], width=0.55)
for r, v, t in zip(bars, d_val, ["~3,000", "9,000+"]):
    b.text(r.get_x() + r.get_width()/2, v, t, ha="center", va="bottom", fontsize=8)
b.set_ylabel("Ads posted per day")
b.set_title("(b) Daily ads: ×3 in one year", fontsize=9, loc="left")
b.set_ylim(0, 10_500)
fig.tight_layout()
save(fig, "fig2_early_growth")

# ----------------------------------------------- Fig 3 ad genuineness (2014)
fig, ax = plt.subplots(figsize=(4.6, 1.5))
genuine, other = 330, 170                       # dt_2014: 330 of 500 sampled ads genuine
ax.barh([0], [genuine], color=UP, height=0.5)
ax.barh([0], [other], left=[genuine], color=DOWN, height=0.5)
ax.text(genuine/2, 0, "330 genuine (66%)", ha="center", va="center", color="white", fontsize=8, weight="bold")
ax.text(genuine + other/2, 0, "170 not (34%)", ha="center", va="center", color="white", fontsize=8, weight="bold")
ax.set_xlim(0, 500); ax.set_yticks([]); ax.set_xlabel("Ads in Bikroy's own random sample (n = 500)")
ax.spines["left"].set_visible(False); ax.grid(False)
save(fig, "fig3_genuine_ads")

# ------------------------------------------- Fig 4 rank in Bangladesh then vs now
fig, ax = plt.subplots(figsize=(6.4, 2.6))
items = [  # label, rank, colour, source
    ("2014 — Alexa\n(local sites)", 8, UP, "bn24_2014"),
    ("Aug 2026 —\nSemrush", 104, DOWN, "semrush_2026"),
    ("Sep 2026 —\nSimilarweb", 67, DOWN, "similarweb_2026"),
]
xs = range(len(items))
bars = ax.bar(xs, [i[1] for i in items], color=[i[2] for i in items], width=0.5)
for r, (_, v, _, _) in zip(bars, items):
    ax.text(r.get_x() + r.get_width()/2, v + 2, f"#{v}", ha="center", va="bottom", fontsize=9, weight="bold")
ax.set_xticks(list(xs)); ax.set_xticklabels([i[0] for i in items], fontsize=8)
ax.set_ylabel("Rank among websites in\nBangladesh (lower = better)")
ax.set_ylim(0, 120)
save(fig, "fig4_bd_rank")

# ---------------------------------------- Fig 5 recent traffic signals 2025-26
fig, (a, b) = plt.subplots(1, 2, figsize=(7.2, 2.6), gridspec_kw={"width_ratios": [1.15, 1]})
lab = ["Dec 2025\n(Semrush)", "Sep 2026\n(Similarweb)"]
val = [-18.93, -12.78]                          # semrush_2025 ; similarweb_2026
bars = a.bar(lab, val, color=DOWN, width=0.5)
for r, v in zip(bars, val):
    a.text(r.get_x() + r.get_width()/2, v - 0.6, f"{v:.2f}%", ha="center", va="top", fontsize=8, weight="bold")
a.axhline(0, color=MUTED, lw=0.8)
a.set_ylim(-24, 2); a.set_ylabel("Visits, change vs\nprevious month (%)")
a.set_title("(a) Month-on-month traffic change", fontsize=9, loc="left")

rk_lab = ["~Jun 2026", "Sep 2026"]
rk = [10_746, 12_370]                           # similarweb_2026 ("over the last three months")
bars = b.bar(rk_lab, rk, color=[NEUTRAL, DOWN], width=0.5)
for r, v in zip(bars, rk):
    b.text(r.get_x() + r.get_width()/2, v + 150, f"#{v:,}", ha="center", va="bottom", fontsize=8, weight="bold")
b.set_ylim(0, 14_500); b.set_ylabel("Global rank (lower = better)")
b.set_title("(b) Global rank, 3 months", fontsize=9, loc="left")
b.set_yticks([0, 4000, 8000, 12000])
b.yaxis.set_major_formatter(matplotlib.ticker.FuncFormatter(lambda x, _: f"{x/1e3:.0f}k"))
fig.tight_layout()
save(fig, "fig5_recent_traffic")

# ------------------------------------------------- Fig 6 Saltside's retreat
fig, ax = plt.subplots(figsize=(6.4, 2.5))
yrs = [2012, 2022.5, 2026.36, 2027]
mk  = [3, 2, 1, 1]                              # fs_jiji: Ghana sold 2022, Bangladesh sold 2026
ax.step(yrs, mk, where="post", color=DOWN, lw=2)
ax.set_yticks([0, 1, 2, 3]); ax.set_ylim(0, 3.6); ax.set_xlim(2011.5, 2027)
ax.set_ylabel("Markets Saltside\nstill operates")
for x, y, t in [(2012.2, 3.12, "Ghana + Bangladesh + Sri Lanka"),
                (2022.6, 2.12, "Tonaton (Ghana) sold to Jiji"),
                (2021.7, 1.12, "Bikroy sold to Jiji (May 2026)")]:
    ax.text(x, y, t, fontsize=7.5, color=INK, va="bottom")
ax.text(2026.7, 0.62, "Sri Lanka\n(ikman) only", fontsize=7, color=MUTED, ha="center")
ax.axvline(2015.07, color=NEUTRAL, ls="--", lw=1)
ax.text(2015.2, 0.25, "Last funding round (Jan 2015, $40M) —\nno new capital for 10+ years", fontsize=7.5, color=MUTED)
ax.set_xticks(range(2012, 2027, 2))
save(fig, "fig6_saltside")

print("written:", sorted(p.name for p in OUT.glob("*.pdf")))

# =============================== SECTION 2 FIGURES ===============================

# ------------------------------------- Fig 7 app-store vs review-site ratings
fig, ax = plt.subplots(figsize=(6.2, 1.9))
rows = [("Google Play (Bikroy app)", 4.3, "210,000 reviews", UP),        # play_store
        ("Trustpilot (bikroy.com)", 2.0, "13 reviews", DOWN)]            # trustpilot
for i, (lab, v, n, c) in enumerate(rows):
    ax.barh(i, v, color=c, height=0.5)
    ax.text(v + 0.06, i, f"{v:.1f} / 5   ({n})", va="center", fontsize=8.5)
ax.set_yticks(range(len(rows))); ax.set_yticklabels([r[0] for r in rows])
ax.invert_yaxis(); ax.set_xlim(0, 5.9); ax.set_xticks(range(6))
ax.set_xlabel("Average rating (stars)")
save(fig, "fig7_ratings")

# ----------------------------- Fig 8 CCAF 2024 victim survey: loss vs recourse
fig, ax = plt.subplots(figsize=(6.2, 1.9))
rows = [("Suffered financial loss", 40.15, DOWN),          # ccaf_2024
        ("Pursued legal action", 12.0, NEUTRAL)]           # ccaf_2024
for i, (lab, v, c) in enumerate(rows):
    ax.barh(i, v, color=c, height=0.5)
    ax.text(v + 1, i, f"{v:g}%", va="center", fontsize=9, weight="bold")
ax.set_yticks(range(len(rows))); ax.set_yticklabels([r[0] for r in rows])
ax.invert_yaxis(); ax.set_xlim(0, 100)
ax.set_xlabel("Share of surveyed cybercrime victims (n = 132), 2023–24")
save(fig, "fig8_ccaf")

# ------------------------- Fig 9 escrow money held vs already paid out (2021)
fig, ax = plt.subplots(figsize=(6.4, 1.7))
settled, held = 2.91, 2.14                                  # fe_refund_2021 (Tk billion)
ax.barh([0], [settled], color=NEUTRAL, height=0.5)
ax.barh([0], [held], left=[settled], color=UP, height=0.5)
ax.text(settled/2, 0, "Tk 2.91 bn already paid\nout to merchants", ha="center", va="center", fontsize=8, color="white", weight="bold")
ax.text(settled + held/2, 0, "Tk 2.14 bn still held:\nreturnable to buyers", ha="center", va="center", fontsize=8, color="white", weight="bold")
ax.set_xlim(0, 5.05); ax.set_yticks([]); ax.spines["left"].set_visible(False); ax.grid(False)
ax.set_xlabel("Customer payments routed through payment gateways since 14 Oct 2021 (Tk billion, total 5.05)")
save(fig, "fig9_escrow_funds")
print("section 2 figures written")

# =============================== SECTION 3 FIGURES ===============================
# Fig 13: which TrustBazaar feature addresses which Bikroy loophole (design mapping,
# derived from the TrustBazaar proposal; 2 = primary fix, 1 = supporting role).
import numpy as np
from matplotlib.colors import ListedColormap
loopholes = ["L1 Weak identity", "L2 No payment protection", "L3 Unsafe handover",
             "L4 No recourse", "L5 No accountability record", "L6 No fair price discovery"]
features = ["NID + selfie\nKYC", "Escrow\nsettlement", "Delivery\ncoordination",
            "Dispute\nresolution", "Ratings +\naudit ledger", "Auction\nengine", "Bid-fraud\ndetection"]
M = np.array([
    # KYC Esc Del Dis Led Auc Bid
    [2, 0, 0, 0, 1, 0, 0],   # L1
    [0, 2, 0, 0, 1, 0, 0],   # L2
    [0, 2, 2, 0, 0, 0, 0],   # L3
    [0, 2, 0, 2, 1, 0, 0],   # L4
    [1, 0, 0, 0, 2, 0, 0],   # L5
    [1, 1, 0, 0, 0, 2, 1],   # L6
])
cmap = ListedColormap(["#f3f4f6", "#93c5fd", UP])
fig, ax = plt.subplots(figsize=(7.2, 3.3))
ax.imshow(M, cmap=cmap, vmin=0, vmax=2, aspect="auto")
ax.set_xticks(range(len(features))); ax.set_xticklabels(features, fontsize=7.8)
ax.xaxis.tick_top()
ax.set_yticks(range(len(loopholes))); ax.set_yticklabels(loopholes, fontsize=8.2)
ax.set_xticks(np.arange(-.5, len(features)), minor=True)
ax.set_yticks(np.arange(-.5, len(loopholes)), minor=True)
ax.grid(which="minor", color="white", linewidth=2); ax.grid(which="major", visible=False)
ax.tick_params(which="both", length=0)
for s in ax.spines.values(): s.set_visible(False)
for i in range(M.shape[0]):
    for j in range(M.shape[1]):
        if M[i, j]:
            ax.text(j, i, "primary" if M[i, j] == 2 else "supports", ha="center", va="center",
                    fontsize=7, color="white" if M[i, j] == 2 else INK)
save(fig, "fig13_mapping")
print("section 3 figure written")

# =============================== SECTION 4 FIGURES ===============================
# Fig 16: capability matrix across platforms (values from Section 4 table; sources there)
caps = ["Individuals'\nused goods", "Identity\ncheck", "Holds\npayment", "Refund\npossible",
        "Managed\nhandover", "Dispute\nprocess", "Fair\nauction", "Digital\ngoods"]
plats = ["Bikroy / Jiji", "Facebook", "Daraz", "TrustBazaar"]
# 2 = full, 1 = partial/weak, 0 = none, -1 = not applicable / out of current scope
C = np.array([
    [2, 1, 0, 0, 0, 0, 0, 0],    # Bikroy/Jiji
    [2, 0, 0, 0, 0, 0, 0, 0],    # Facebook
    [0, 2, 2, 2, 2, 1, 0, -1],   # Daraz
    [2, 2, 2, 2, 2, 2, 2, 2],    # TrustBazaar (digital goods: game-account escrow, revised proposal)
])
cmap4 = ListedColormap(["#e5e7eb", "#fca5a5", "#fcd34d", "#60a5fa"])
fig, ax = plt.subplots(figsize=(7.2, 2.7))
ax.imshow(C + 1, cmap=cmap4, vmin=0, vmax=3, aspect="auto")
ax.set_xticks(range(len(caps))); ax.set_xticklabels(caps, fontsize=7.2); ax.xaxis.tick_top()
ax.set_yticks(range(len(plats))); ax.set_yticklabels(plats, fontsize=8.5)
ax.set_xticks(np.arange(-.5, len(caps)), minor=True); ax.set_yticks(np.arange(-.5, len(plats)), minor=True)
ax.grid(which="minor", color="white", linewidth=2); ax.grid(which="major", visible=False)
ax.tick_params(which="both", length=0)
for s in ax.spines.values(): s.set_visible(False)
lab = {2: "yes", 1: "partial", 0: "no", -1: "not\nexamined"}
for i in range(C.shape[0]):
    for j in range(C.shape[1]):
        t = lab[C[i, j]]
        ax.text(j, i, t, ha="center", va="center", fontsize=7, color=INK)
save(fig, "fig16_capabilities")

# Fig 17: qualitative positioning map
fig, ax = plt.subplots(figsize=(5.6, 4.2))
ax.axhline(0, color=MUTED, lw=1); ax.axvline(0, color=MUTED, lw=1)
ax.set_xlim(-1, 1); ax.set_ylim(-1, 1); ax.set_xticks([]); ax.set_yticks([]); ax.grid(False)
for s in ax.spines.values(): s.set_visible(False)
ax.fill_between([-1, 0], 0, 1, color=UP, alpha=0.08, lw=0)
pts = [("Bikroy / Jiji", -0.62, -0.55, DOWN), ("Facebook groups\n& Marketplace", -0.62, -0.82, DOWN),
       ("Daraz", 0.60, 0.62, NEUTRAL), ("TrustBazaar", -0.52, 0.60, UP)]
for name, x, y, c in pts:
    ax.scatter([x], [y], s=140, color=c, zorder=3, edgecolor="white", linewidth=1.5)
    ax.text(x + 0.07, y, name, va="center", fontsize=8.5, weight="bold" if name == "TrustBazaar" else None)
ax.text(-0.98, 0.93, "Gap: individual resale\nwith transaction protection", fontsize=7.5, color=UP, va="top")
ax.text(0, -1.06, "Individuals selling used goods   ←   who it is built for   →   businesses selling new stock",
        ha="center", va="top", fontsize=7.5, color=INK)
ax.text(-1.06, 0, "No protection   ←   platform protects the transaction   →   protects",
        rotation=90, ha="right", va="center", fontsize=7.5, color=INK)
save(fig, "fig17_positioning")
print("section 4 figures written")

# ============================ SECTION 2: CATALOGUE & TRAFFIC ============================
# Live ad counts per top-level category, snapshot of bikroy.com category pages, 7 Oct 2026
# (source key: bikroy_cats). Counts are "N results for <category> in Bangladesh".
cats = [
    ("Phones & Tablets", 85553), ("Electronics", 57170), ("Home, Furniture & Appliances", 32892),
    ("Vehicles", 29987), ("Fashion", 21139), ("Animals & Pets", 15900), ("Property", 14242),
    ("Leisure & Activities", 13000), ("Commercial Equipment & Tools", 5861),
    ("Food, Agriculture & Farming", 5471), ("Beauty & Personal Care", 4761),
    ("Seeking Work (CVs)", 4565), ("Services", 3520), ("Babies & Kids", 3175),
    ("Jobs", 1979), ("Repair & Construction", 1295), ("Business & Industry", 125),
]
total = sum(v for _, v in cats)
cats_sorted = sorted(cats, key=lambda c: c[1])
HIGH = {"Vehicles", "Property"}
fig, ax = plt.subplots(figsize=(7.2, 4.6))
ys = range(len(cats_sorted))
ax.barh(list(ys), [v for _, v in cats_sorted],
        color=[DOWN if n in HIGH else UP for n, _ in cats_sorted], height=0.68)
for y, (n, v) in zip(ys, cats_sorted):
    ax.text(v + 900, y, f"{v:,}  ({100*v/total:.1f}%)" if v/total >= 0.001 else f"{v:,}  (<0.1%)", va="center", fontsize=7.4)
ax.set_yticks(list(ys)); ax.set_yticklabels([n for n, _ in cats_sorted], fontsize=7.8)
ax.set_xlim(0, 112_000)
ax.xaxis.set_major_formatter(matplotlib.ticker.FuncFormatter(lambda x, _: f"{x/1e3:.0f}k"))
ax.set_xlabel(f"Live ads on Bikroy, 7 Oct 2026 (sum of categories = {total:,})")
ax.grid(axis="y", visible=False)
save(fig, "fig_cat_counts")

# Used vs new share in the two biggest everyday-goods subcategories (same snapshot)
groups = [("Mobile phones\n(n = 75,392)", 68360, 1528, 5303),
          ("Laptops & computers\n(n = 20,717)", 18308, 257, 2130)]
fig, ax = plt.subplots(figsize=(7.0, 1.9))
for i, (lab_, used, refurb, new) in enumerate(groups):
    tot = used + refurb + new
    left = 0
    for val, col, name in [(used, DOWN, "Used"), (refurb, "#f59e0b", "Refurb."), (new, NEUTRAL, "New")]:
        share = 100 * val / tot
        ax.barh(i, share, left=left, color=col, height=0.55)
        if share > 30:
            ax.text(left + share / 2, i, f"{name} {share:.0f}%", ha="center", va="center",
                    fontsize=7.6, color="white", weight="bold")
        left += share
    ax.text(101, i, f"refurb. {100*refurb/tot:.0f}%  new {100*new/tot:.0f}%", va="center", fontsize=7.4)
ax.set_yticks([0, 1]); ax.set_yticklabels([g[0] for g in groups], fontsize=8)
ax.invert_yaxis(); ax.set_xlim(0, 100)
ax.set_xlabel("Share of ads by condition (%); condition filter counts, 7 Oct 2026")
ax.grid(axis="y", visible=False)
save(fig, "fig_used_share")

# Company-reported monthly audience over time (same definition: monthly unique users)
yrs = ["Sep 2014", "Mar 2017", "May 2026"]
vals = [2.0, 2.0, 3.0]            # fe_2014 "more than 2.0 million"; fs_b2b "around two million"; fs_jiji "about three million"
labels = ["2.0M+", "~2M", "~3M"]
fig, ax = plt.subplots(figsize=(4.8, 2.6))
bars = ax.bar(yrs, vals, color=[NEUTRAL, NEUTRAL, UP], width=0.5)
for r, t in zip(bars, labels):
    ax.text(r.get_x() + r.get_width()/2, r.get_height() + 0.06, t, ha="center", va="bottom",
            fontsize=8.5, weight="bold")
ax.set_ylim(0, 3.6); ax.set_ylabel("Monthly unique visitors\n(million, company-reported)")
save(fig, "fig_audience_years")
print("catalogue figures written; category sum =", total)
