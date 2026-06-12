import { volcengineAsrTimeoutMs } from "../../../packages/ai/src/volcengine-transcript-provider.ts";

const oneHourMs = 60 * 60 * 1000;
const shortTimeout = volcengineAsrTimeoutMs(600, oneHourMs);
const threeHourTimeout = volcengineAsrTimeoutMs(3 * 60 * 60, oneHourMs);

if (shortTimeout !== oneHourMs) {
  throw new Error(`Short episodes should keep the base timeout, got ${shortTimeout}.`);
}

if (threeHourTimeout !== 4 * oneHourMs) {
  throw new Error(`Long episodes should get duration plus one hour, got ${threeHourTimeout}.`);
}

console.log("Volcengine timeout check passed.");
