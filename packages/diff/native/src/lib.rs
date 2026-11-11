//! Native port of pixelmatch 8 (https://github.com/mapbox/pixelmatch) for `@circi/diff`.
//!
//! The arithmetic follows the JavaScript source operation for operation (same f64 expressions in
//! the same order, same lookup tables, same truncation), so counts and diff images match the JS
//! engine. Every pixel's verdict reads only the two inputs, never another verdict, so rows run in
//! parallel (rayon) without changing any result.

mod compare;

use napi::bindgen_prelude::{AsyncTask, Buffer};
use napi::{Env, Task};
use napi_derive::napi;

pub use compare::{compare, Options};

#[napi(object)]
pub struct CompareOptions {
    /// Maximum OKLab HyAB distance (0..1) still considered equal.
    pub threshold: f64,
    /// Count anti-aliased pixels as differences instead of ignoring them.
    pub include_aa: bool,
    /// Opacity of the original image in the diff output.
    pub alpha: f64,
    /// Draw the diff image; without it only the count is computed.
    pub with_output: bool,
}

#[napi(object)]
pub struct CompareResult {
    pub changed_pixels: f64,
    /// RGBA, `width * height * 4` bytes; present when `withOutput`.
    pub output: Option<Buffer>,
}

type Computed = (u64, Option<Vec<u8>>);

fn run(a: &[u8], b: &[u8], width: u32, height: u32, o: &CompareOptions) -> napi::Result<Computed> {
    let len = (width as usize) * (height as usize) * 4;
    if a.len() != len || b.len() != len {
        return Err(napi::Error::from_reason(format!(
            "Image data size does not match width/height. Expecting {len}. Got {} and {}",
            a.len(),
            b.len()
        )));
    }
    let mut out = if o.with_output { Some(vec![0u8; len]) } else { None };
    let n = compare(
        a,
        b,
        out.as_deref_mut(),
        width as usize,
        height as usize,
        &Options { threshold: o.threshold, include_aa: o.include_aa, alpha: o.alpha },
    );
    Ok((n, out))
}

fn result((n, out): Computed) -> CompareResult {
    CompareResult { changed_pixels: n as f64, output: out.map(Buffer::from) }
}

/// Blocking version (tests and benchmarks); the worker uses `compareAsync`, which leaves the event loop free.
#[napi]
pub fn compare_sync(
    a: Buffer,
    b: Buffer,
    width: u32,
    height: u32,
    options: CompareOptions,
) -> napi::Result<CompareResult> {
    Ok(result(run(&a, &b, width, height, &options)?))
}

pub struct CompareTask {
    a: Buffer,
    b: Buffer,
    width: u32,
    height: u32,
    options: CompareOptions,
}

impl Task for CompareTask {
    type Output = Computed;
    type JsValue = CompareResult;

    fn compute(&mut self) -> napi::Result<Self::Output> {
        run(&self.a, &self.b, self.width, self.height, &self.options)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> napi::Result<Self::JsValue> {
        Ok(result(output))
    }
}

/// Compares two equally sized RGBA images on the libuv pool (rows in parallel on rayon's pool).
#[napi(ts_return_type = "Promise<CompareResult>")]
pub fn compare_async(
    a: Buffer,
    b: Buffer,
    width: u32,
    height: u32,
    options: CompareOptions,
) -> AsyncTask<CompareTask> {
    AsyncTask::new(CompareTask { a, b, width, height, options })
}
