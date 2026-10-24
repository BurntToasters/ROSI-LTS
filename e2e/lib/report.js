const fs = require("fs");
const path = require("path");

function status(passed) {
  return passed ? "PASS" : "FAIL";
}

function escapeCell(text) {
  return String(text ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\n/g, "<br>");
}

function renderMarkdown(report) {
  const env = report.environment;
  const lines = [];
  lines.push("# ROSI-LTS E2E report");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}  `);
  lines.push(`Total duration: ${(report.durationMs / 1000).toFixed(1)} s  `);
  lines.push(
    `Result: ${report.summary.passed} passed, ${report.summary.failed} failed of ${report.summary.total}`,
  );
  lines.push("");
  lines.push("## Environment");
  lines.push("");
  lines.push("| Item | Value |");
  lines.push("| --- | --- |");
  for (const [key, value] of Object.entries(env)) {
    lines.push(`| ${escapeCell(key)} | ${escapeCell(value)} |`);
  }
  lines.push("");
  if (report.setupError) {
    lines.push("## Setup error");
    lines.push("");
    lines.push("```");
    lines.push(report.setupError);
    lines.push("```");
    lines.push("");
  }
  lines.push("## Specs");
  lines.push("");
  lines.push("| Spec | Title | Result | Duration (s) | Failure modes |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const spec of report.specs) {
    lines.push(
      `| ${spec.id} | ${escapeCell(spec.title)} | ${status(spec.passed)} | ${(spec.durationMs / 1000).toFixed(1)} | ${escapeCell(spec.failureModes.join(", ") || "-")} |`,
    );
  }
  lines.push("");
  for (const spec of report.specs) {
    lines.push(`## ${spec.id}: ${spec.title}`);
    lines.push("");
    lines.push(`Result: **${status(spec.passed)}**  `);
    lines.push(`Duration: ${(spec.durationMs / 1000).toFixed(1)} s  `);
    lines.push(
      `Screenshot: ${spec.screenshot ? `[${path.basename(spec.screenshot)}](${path.basename(spec.screenshot)})` : "not captured"}  `,
    );
    if (spec.failureMessage) {
      lines.push("");
      lines.push("Failure:");
      lines.push("");
      lines.push("```");
      lines.push(spec.failureMessage);
      lines.push("```");
    }
    if (spec.checks.length) {
      lines.push("");
      lines.push("| Check | Result | Detail |");
      lines.push("| --- | --- | --- |");
      for (const check of spec.checks) {
        lines.push(
          `| ${escapeCell(check.label)} | ${status(check.passed)} | ${escapeCell(check.detail)} |`,
        );
      }
    }
    if (spec.files.length) {
      lines.push("");
      lines.push("| File | Bytes | SHA-256 |");
      lines.push("| --- | --- | --- |");
      for (const file of spec.files) {
        lines.push(
          `| ${escapeCell(file.label)} | ${file.bytes} | ${file.sha256} |`,
        );
      }
    }
    if (spec.notes.length) {
      lines.push("");
      lines.push("Notes:");
      for (const note of spec.notes) lines.push(`- ${note}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function writeReport(artifactsDir, report) {
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(
    path.join(artifactsDir, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  fs.writeFileSync(
    path.join(artifactsDir, "report.md"),
    renderMarkdown(report),
  );
}

module.exports = { writeReport, renderMarkdown };
