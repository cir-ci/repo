use rayon::prelude::*;
use std::sync::OnceLock;

pub struct Options {
    pub threshold: f64,
    pub include_aa: bool,
    pub alpha: f64,
}

const AA_COLOR: [u8; 3] = [255, 255, 0];
const DIFF_COLOR: [u8; 3] = [255, 0, 0];

const CBRT_N: usize = 4096;
const CBRT_EXACT: i64 = 8;
const TOE_K1: f64 = 0.206;
const TOE_K2: f64 = 0.03;
const TOE_K3: f64 = (1.0 + TOE_K1) / (1.0 + TOE_K2);

struct Tables {
    lin: [f64; 257],
    cbrt: Vec<f64>,
    l: [[f64; 256]; 3],
    m: [[f64; 256]; 3],
    s: [[f64; 256]; 3],
}

fn tables() -> &'static Tables {
    static T: OnceLock<Tables> = OnceLock::new();
    T.get_or_init(|| {
        let mut lin = [0.0; 257];
        for (i, v) in lin.iter_mut().enumerate().take(256) {
            let c = i as f64 / 255.0;
            *v = if c <= 0.04045 { c / 12.92 } else { ((c + 0.055) / 1.055).powf(2.4) };
        }
        lin[256] = lin[255];
        let (mut l, mut m, mut s) = ([[0.0; 256]; 3], [[0.0; 256]; 3], [[0.0; 256]; 3]);
        for i in 0..256 {
            let v = lin[i];
            l[0][i] = 0.4122214708 * v;
            m[0][i] = 0.2119034982 * v;
            s[0][i] = 0.0883024619 * v;
            l[1][i] = 0.5363325363 * v;
            m[1][i] = 0.6806995451 * v;
            s[1][i] = 0.2817188376 * v;
            l[2][i] = 0.0514459929 * v;
            m[2][i] = 0.1073969566 * v;
            s[2][i] = 0.6299787005 * v;
        }
        let cbrt = (0..=CBRT_N + 1).map(|i| (i as f64 / CBRT_N as f64).cbrt()).collect();
        Tables { lin, cbrt, l, m, s }
    })
}

#[inline(always)]
fn lin_lut(t: &Tables, x: f64) -> f64 {
    let i = x as usize;
    t.lin[i] + (t.lin[i + 1] - t.lin[i]) * (x - i as f64)
}

#[inline(always)]
fn cbrt_lut(t: &Tables, x: f64) -> f64 {
    let tt = x * CBRT_N as f64;
    let i = tt as i64;
    if i < CBRT_EXACT {
        return x.cbrt();
    }
    let i = i as usize;
    t.cbrt[i] + (t.cbrt[i + 1] - t.cbrt[i]) * (tt - i as f64)
}

#[inline(always)]
fn lightness(l: f64, m: f64, s: f64) -> f64 {
    let big_l = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
    let x = TOE_K3 * big_l - TOE_K1;
    0.5 * (x + (x * x + 4.0 * TOE_K2 * TOE_K3 * big_l).sqrt())
}

/// 0 when within the threshold, else 1 (img2 pixel lighter) or -1 (darker).
#[inline(always)]
fn hyab_delta(d_lr: f64, dl: f64, dm: f64, ds: f64, max_delta: f64) -> i8 {
    let rest = max_delta - d_lr.abs();
    if rest >= 0.0 {
        let da = 1.9779984951 * dl - 2.4285922050 * dm + 0.4505937099 * ds;
        let db = 0.0259040371 * dl + 0.7827717662 * dm - 0.8086757660 * ds;
        if da * da + db * db <= rest * rest {
            return 0;
        }
    }
    if d_lr > 0.0 {
        -1
    } else {
        1
    }
}

#[inline(always)]
fn color_delta(t: &Tables, p1: [u8; 4], p2: [u8; 4], index: u32, max_delta: f64) -> i8 {
    let [r1, g1, b1, a1] = p1;
    let [r2, g2, b2, a2] = p2;
    if a1 == 255 && a2 == 255 {
        let (r1, g1, b1) = (r1 as usize, g1 as usize, b1 as usize);
        let (r2, g2, b2) = (r2 as usize, g2 as usize, b2 as usize);
        let l1 = cbrt_lut(t, t.l[0][r1] + t.l[1][g1] + t.l[2][b1]);
        let m1 = cbrt_lut(t, t.m[0][r1] + t.m[1][g1] + t.m[2][b1]);
        let s1 = cbrt_lut(t, t.s[0][r1] + t.s[1][g1] + t.s[2][b1]);
        let l2 = cbrt_lut(t, t.l[0][r2] + t.l[1][g2] + t.l[2][b2]);
        let m2 = cbrt_lut(t, t.m[0][r2] + t.m[1][g2] + t.m[2][b2]);
        let s2 = cbrt_lut(t, t.s[0][r2] + t.s[1][g2] + t.s[2][b2]);
        return hyab_delta(
            lightness(l1, m1, s1) - lightness(l2, m2, s2),
            l1 - l2,
            m1 - m2,
            s1 - s2,
            max_delta,
        );
    }
    // Semi-transparent: blend over the checkerboard (8 dark/light colours by a Fibonacci hash of
    // the pixel index).
    let h = index.wrapping_mul(0x9e3779b1);
    let rb = (48 + 159 * (h >> 31)) as f64;
    let gb = (48 + 159 * ((h >> 30) & 1)) as f64;
    let bb = (48 + 159 * ((h >> 29) & 1)) as f64;
    let (fa1, fa2) = (a1 as f64, a2 as f64);
    let blend = |c: u8, a: f64, bg: f64| (c as f64 * a + bg * (255.0 - a)) / 255.0;
    let (r1, g1, b1) = (blend(r1, fa1, rb), blend(g1, fa1, gb), blend(b1, fa1, bb));
    let (r2, g2, b2) = (blend(r2, fa2, rb), blend(g2, fa2, gb), blend(b2, fa2, bb));
    let (lr1, lg1, lb1) = (lin_lut(t, r1), lin_lut(t, g1), lin_lut(t, b1));
    let (lr2, lg2, lb2) = (lin_lut(t, r2), lin_lut(t, g2), lin_lut(t, b2));
    let l1 = cbrt_lut(t, 0.4122214708 * lr1 + 0.5363325363 * lg1 + 0.0514459929 * lb1);
    let m1 = cbrt_lut(t, 0.2119034982 * lr1 + 0.6806995451 * lg1 + 0.1073969566 * lb1);
    let s1 = cbrt_lut(t, 0.0883024619 * lr1 + 0.2817188376 * lg1 + 0.6299787005 * lb1);
    let l2 = cbrt_lut(t, 0.4122214708 * lr2 + 0.5363325363 * lg2 + 0.0514459929 * lb2);
    let m2 = cbrt_lut(t, 0.2119034982 * lr2 + 0.6806995451 * lg2 + 0.1073969566 * lb2);
    let s2 = cbrt_lut(t, 0.0883024619 * lr2 + 0.2817188376 * lg2 + 0.6299787005 * lb2);
    hyab_delta(lightness(l1, m1, s1) - lightness(l2, m2, s2), l1 - l2, m1 - m2, s1 - s2, max_delta)
}

#[inline(always)]
fn px(img: &[u8], i: usize) -> [u8; 4] {
    let k = i * 4;
    [img[k], img[k + 1], img[k + 2], img[k + 3]]
}

/// Gamma-space Rec.601 luma delta between the centre pixel and a neighbour (white-composited when
/// semi-transparent); see pixelmatch's `brightnessDelta`.
#[inline(always)]
fn brightness_delta(img: &[u8], m: usize, c: [u8; 4]) -> f64 {
    let [r1, g1, b1, a1] = [c[0] as f64, c[1] as f64, c[2] as f64, c[3] as f64];
    let (r2, g2, b2, a2) = (img[m] as f64, img[m + 1] as f64, img[m + 2] as f64, img[m + 3] as f64);
    let mut dr = r1 - r2;
    let mut dg = g1 - g2;
    let mut db = b1 - b2;
    let da = a1 - a2;
    if dr == 0.0 && dg == 0.0 && db == 0.0 && da == 0.0 {
        return 0.0;
    }
    if a1 < 255.0 || a2 < 255.0 {
        dr = (r1 * a1 - r2 * a2 - 255.0 * da) / 255.0;
        dg = (g1 * a1 - g2 * a2 - 255.0 * da) / 255.0;
        db = (b1 * a1 - b2 * a2 - 255.0 * da) / 255.0;
        let d = dr * 0.29889531 + dg * 0.58662247 + db * 0.11448223;
        return if d == 0.0 && da != 0.0 { da / 2.0 } else { d };
    }
    dr * 0.29889531 + dg * 0.58662247 + db * 0.11448223
}

fn has_many_siblings(img: &[u8], x1: usize, y1: usize, w: usize, h: usize) -> bool {
    let val = px(img, y1 * w + x1);
    let x0 = if x1 > 0 { x1 - 1 } else { 0 };
    let y0 = if y1 > 0 { y1 - 1 } else { 0 };
    let x2 = if x1 < w - 1 { x1 + 1 } else { w - 1 };
    let y2 = if y1 < h - 1 { y1 + 1 } else { h - 1 };
    let mut zeroes = if x1 == x0 || x1 == x2 || y1 == y0 || y1 == y2 { 1 } else { 0 };
    for x in x0..=x2 {
        for y in y0..=y2 {
            if x == x1 && y == y1 {
                continue;
            }
            if px(img, y * w + x) == val {
                zeroes += 1;
            }
            if zeroes > 2 {
                return true;
            }
        }
    }
    false
}

/// Anti-aliased pixel and intensity slope detector (Vysniauskas, 2009), as in pixelmatch.
fn antialiased(img: &[u8], x1: usize, y1: usize, w: usize, h: usize, a: &[u8], b: &[u8]) -> bool {
    let x0 = if x1 > 0 { x1 - 1 } else { 0 };
    let y0 = if y1 > 0 { y1 - 1 } else { 0 };
    let x2 = if x1 < w - 1 { x1 + 1 } else { w - 1 };
    let y2 = if y1 < h - 1 { y1 + 1 } else { h - 1 };
    let centre = px(img, y1 * w + x1);
    let mut zeroes = if x1 == x0 || x1 == x2 || y1 == y0 || y1 == y2 { 1 } else { 0 };
    let (mut min, mut max) = (0.0f64, 0.0f64);
    let (mut min_x, mut min_y, mut max_x, mut max_y) = (0, 0, 0, 0);
    for x in x0..=x2 {
        for y in y0..=y2 {
            if x == x1 && y == y1 {
                continue;
            }
            let delta = brightness_delta(img, (y * w + x) * 4, centre);
            if delta == 0.0 {
                zeroes += 1;
                if zeroes > 2 {
                    return false;
                }
            } else if delta < min {
                min = delta;
                min_x = x;
                min_y = y;
            } else if delta > max {
                max = delta;
                max_x = x;
                max_y = y;
            }
        }
    }
    if min == 0.0 || max == 0.0 {
        return false;
    }
    (has_many_siblings(a, min_x, min_y, w, h) && has_many_siblings(b, min_x, min_y, w, h))
        || (has_many_siblings(a, max_x, max_y, w, h) && has_many_siblings(b, max_x, max_y, w, h))
}

#[inline(always)]
fn draw(out: &mut [u8], x: usize, c: [u8; 3]) {
    let p = x * 4;
    out[p] = c[0];
    out[p + 1] = c[1];
    out[p + 2] = c[2];
    out[p + 3] = 255;
}

#[inline(always)]
fn draw_gray(out: &mut [u8], x: usize, img: &[u8], i: usize, alpha: f64) {
    let k = i * 4;
    let luma =
        img[k] as f64 * 0.29889531 + img[k + 1] as f64 * 0.58662247 + img[k + 2] as f64 * 0.11448223;
    let val = 255.0 + (luma - 255.0) * alpha * img[k + 3] as f64 / 255.0;
    let v = val as u8; // truncates like a Uint8Array store (val is within 0..=255.01)
    draw(out, x, [v, v, v]);
}

fn row(
    t: &Tables,
    a: &[u8],
    b: &[u8],
    mut out: Option<&mut [u8]>,
    (y, w, h): (usize, usize, usize),
    o: &Options,
) -> u64 {
    let mut diff = 0u64;
    for x in 0..w {
        let i = y * w + x;
        let (pa, pb) = (px(a, i), px(b, i));
        let delta = if pa == pb { 0 } else { color_delta(t, pa, pb, i as u32, o.threshold) };
        if delta != 0 {
            let excluded = !o.include_aa
                && (antialiased(a, x, y, w, h, a, b) || antialiased(b, x, y, w, h, b, a));
            if excluded {
                if let Some(out) = out.as_deref_mut() {
                    draw(out, x, AA_COLOR);
                }
            } else {
                if let Some(out) = out.as_deref_mut() {
                    draw(out, x, DIFF_COLOR);
                }
                diff += 1;
            }
        } else if let Some(out) = out.as_deref_mut() {
            draw_gray(out, x, a, i, o.alpha);
        }
    }
    diff
}

/// Number of pixels that differ beyond the threshold (anti-aliasing excluded unless
/// `include_aa`); draws pixelmatch's diff image into `output` when given. `a`, `b` and `output`
/// hold `width * height` RGBA pixels.
pub fn compare(
    a: &[u8],
    b: &[u8],
    output: Option<&mut [u8]>,
    w: usize,
    h: usize,
    o: &Options,
) -> u64 {
    if w == 0 || h == 0 {
        return 0;
    }
    let t = tables();
    match output {
        Some(out) => out
            .par_chunks_mut(w * 4)
            .enumerate()
            .map(|(y, r)| row(t, a, b, Some(r), (y, w, h), o))
            .sum(),
        None => (0..h).into_par_iter().map(|y| row(t, a, b, None, (y, w, h), o)).sum(),
    }
}
