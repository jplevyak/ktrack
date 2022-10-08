import levelup from "levelup";
import leveldown from "leveldown";
import { merge_items, make_favorites } from "../_util.js";
import { do_post } from "../_post.js";

var favorites = levelup(leveldown("./favorites"));

export async function POST(req) {
  return await do_post(
    req,
    favorites,
    "favorites",
    merge_items,
    make_favorites
  );
}
