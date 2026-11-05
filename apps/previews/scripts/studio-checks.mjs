// A browser check passes only when its assertion explicitly returns true.
// Diagnostic strings explain failures; they must never count as successful checks.
export function createStudioChecks({ keepFailure, log = console.log }) {
  const results = [];
  const check = (name, ok, detail = "") => {
    const passed = ok === true;
    results.push({ name, ok: passed });
    log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  };
  const step = async (name, fn) => {
    let result;
    try {
      result = await fn();
    } catch (error) {
      check(name, false, String(error).split("\n")[0].slice(0, 240));
      await keepFailure(name, error);
      return;
    }
    const detail = typeof result === "string" ? result : "";
    check(name, result === true, detail);
    if (result !== true) {
      await keepFailure(name, detail || "check did not return true");
    }
  };
  const finish = () => {
    const passed = results.filter((result) => result.ok).length;
    log(`\n${passed}/${results.length} studio checks passed`);
    return passed === results.length ? 0 : 1;
  };
  return { check, step, finish };
}
