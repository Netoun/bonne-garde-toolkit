# Builds logo.svg and logo-construction.svg: a sword guard (the T) whose
# outline draws a B in its hollow and a G cut into the pommel. Every curve is a circle
# arc with a Fibonacci radius. Run: python3 build-logo.py
import math, os

HERE = os.path.dirname(os.path.abspath(__file__))

def add(a, b): return (a[0] + b[0], a[1] + b[1])
def sub(a, b): return (a[0] - b[0], a[1] - b[1])
def mul(a, k): return (a[0] * k, a[1] * k)
def unit(a): n = math.hypot(*a); return (a[0] / n, a[1] / n)
def ang(c, p): return math.atan2(p[1] - c[1], p[0] - c[0])

def circle_inter(c1, r1, c2, r2):
    d = math.hypot(*sub(c2, c1)); a = (r1 * r1 - r2 * r2 + d * d) / (2 * d)
    h = math.sqrt(r1 * r1 - a * a); u = unit(sub(c2, c1)); m = add(c1, mul(u, a))
    return add(m, mul((-u[1], u[0]), h)), add(m, mul((u[1], -u[0]), h))

W, H = 377, 254
cx = 144                              # axis: 377 = 233 + 144, both ratios are phi
bar = 34                              # guard thickness
E = (cx, 89.0); rE = 89               # right edge of the hilt, touches the top line
F = (cx + 144, bar + 55.0); rF = 55   # cove under the right arm, tangent to E: 89 + 55 = 144
UB = (cx, 55.0); rU = 21              # upper bowl of the B (hollow)
LB = (cx, 110.0); rL = 34             # lower bowl of the B (hollow), 34/21 = phi
P = (cx, 199.0); rP = 55              # pommel, tangent to the lower bowl
Q = (cx + rP, P[1] - 89); rQ = 89     # hollow that cuts the pommel into a G: bar at the pommel's right edge, point under the hilt
EQ = max(circle_inter(E, rE, Q, rQ), key=lambda p: p[1])

tip = (W - 21.0, float(bar))          # right tip: same 21:34 slant as the left one

d = []
def pt(p): return f"{p[0]:.2f} {p[1]:.2f}"
def M(p): d.append("M" + pt(p))
def L(p): d.append("L" + pt(p))
def arc(c, r, p0, p1, cw):
    a0, a1 = ang(c, p0), ang(c, p1)
    span = (a1 - a0) % (2 * math.pi) if cw else (a0 - a1) % (2 * math.pi)
    d.append(f"A{r} {r} 0 {int(span > math.pi)} {int(cw)} " + pt(p1))

M((21.0, 0.0)); L((W, 0.0)); L(tip); L((F[0], float(bar)))
arc(F, rF, (F[0], float(bar)), (cx + rE, E[1]), False)
arc(E, rE, (cx + rE, E[1]), EQ, True)
arc(Q, rQ, EQ, (cx + rP, P[1]), False)
arc(P, rP, (cx + rP, P[1]), (cx, 144.0), True)
arc(LB, rL, (cx, 144.0), (cx, 76.0), False)
arc(UB, rU, (cx, 76.0), (cx, float(bar)), False)
L((0.0, float(bar))); d.append("Z")
path = " ".join(d)

pad = 21
with open(os.path.join(HERE, "logo.svg"), "w") as f:
    f.write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{-pad} {-pad} {W + 2 * pad} {H + 2 * pad}">'
            f'<path fill="#1c1a17" d="{path}"/></svg>\n')

circles = [(E, rE), (F, rF), (UB, rU), (LB, rL), (P, rP), (Q, rQ)]
rings = "".join(f'<circle cx="{c[0]:.2f}" cy="{c[1]:.2f}" r="{r}"/>' for c, r in circles)
guides = (f'<line x1="{cx}" y1="-40" x2="{cx}" y2="{H + 42}"/>'
          f'<line x1="-40" y1="0" x2="{W + 43}" y2="0"/><line x1="-40" y1="{bar}" x2="{W + 43}" y2="{bar}"/>')
with open(os.path.join(HERE, "logo-construction.svg"), "w") as f:
    f.write(f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="-40 -40 {W + 80} {H + 82}">
<rect x="-40" y="-40" width="{W + 80}" height="{H + 82}" fill="#fbfaf7"/>
<path fill="#1c1a17" fill-opacity=".9" d="{path}"/>
<g fill="none" stroke="#c0392b" stroke-width=".6">{rings}</g>
<g stroke="#2f6fb0" stroke-width=".5" stroke-dasharray="3 3">{guides}</g>
</svg>
''')
