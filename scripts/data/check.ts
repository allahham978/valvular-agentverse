import { existsSync } from "node:fs";

if (existsSync("data/hearts.dev.json")) {
  console.log("data:check: hearts data present, checks arrive with REQ-2");
} else {
  console.log("data:check: no data/hearts.dev.json yet, skipping");
}
