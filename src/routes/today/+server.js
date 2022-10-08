import levelup from "levelup";
import leveldown from "leveldown";
import { merge_day, make_historical_day } from "../_util.js";
import { do_post } from "../_post.js";

var today = levelup(leveldown("./today"));

export async function POST(req) {
  return await do_post(req, today, "today", merge_day, () =>
    make_historical_day(today, 10000)
  );
}
