import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const css = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");
const colors = Object.fromEntries([...css.matchAll(/--color-([\w-]+):\s*(#[\da-f]+);/g)].map((match) => [match[1], match[2]]));
function luminance(hex: string) {
  const expanded = hex.length === 4 ? hex.slice(1).split("").map(value => value + value).join("") : hex.slice(1);
  return [0, 2, 4].map(index => parseInt(expanded.slice(index, index + 2), 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
}
const pairs = [
  ...["canvas", "paper", "white", "moss-soft", "vermilion-soft", "gold-soft", "indigo-soft"]
    .flatMap(background => ["ink", "muted", "faint"].map(text => [text, background])),
  ["white", "vermilion"], ["vermilion-ink", "vermilion-soft"],
  ["moss-ink", "moss-soft"], ["indigo", "indigo-soft"], ["gold", "gold-soft"],
];
it.each(pairs)("keeps normal %s text readable on %s", (text, background) => {
  const values = [luminance(colors[text]), luminance(colors[background])].sort((a, b) => a - b);
  expect((values[1] + 0.05) / (values[0] + 0.05)).toBeGreaterThanOrEqual(4.5);
});
