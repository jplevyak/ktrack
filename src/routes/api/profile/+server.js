import { merge_profile, make_profile } from "../../_util.js";
import { do_post_internal, profile } from "../../_post.js";

function finalize_profile(p) {
  if (p != undefined) {
    p.password = "";
    p.old_password = "";
  }
  return p;
}

export async function POST(req) {
  let data = await req.request.json();
  return await do_post_internal(
    req,
    data,
    data.username,
    profile,
    "profile",
    merge_profile,
    make_profile,
    finalize_profile
  );
}
