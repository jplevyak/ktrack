import { do_sync_batch } from "../_post.js";
import { prune_today, prune_history } from "../../_util.js";
import { today, history, favorites } from "../_dbs.js";

const dbs = {
  today,
  history,
  favorites,
};

const prunes = {
  today: prune_today,
  history: prune_history,
};

const defaults = {
  today: "{}",
  history: "[]",
  favorites: "[]",
};

export async function POST(req) {
  return await do_sync_batch(req, dbs, prunes, defaults);
}
