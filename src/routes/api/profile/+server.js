import { merge_profile, make_profile } from "../../_util.js";
import { profile } from "../../_post.js";

function finalize_profile(p) {
  if (p != undefined) {
    p.password = "";
    p.old_password = "";
  }
  return p;
}

async function do_post(
  req,
  data,
  username,
  db,
  title,
  merge,
  make,
  finalize
) {
  let value = await db.get(username);
  var result = ""; // request nothing.
  if (value != undefined) {
    value = JSON.parse(value);
    if (value == undefined) {
      console.log("bad json");
    }
  }
  if (data.value == undefined) {
    // nothing sent and/or status request
    if (value == undefined) {
      result = make(); // request all
      delete result.updated;
    } else if (data.updated != value.updated) {
      result = value; // send what we have
    } else {
      result = ""; // we are up to date, do nothing
    }
  }  else {
    // update sent
    if (value != undefined) result = merge(value, data.value);
    else result = data.value;
    // store if we have nothing or if it is different
    if (value == undefined || data.updated < result.updated || result.updated != value.updated) {
      let string_value = JSON.stringify(result);
      await db.put(username, string_value);
    } else {
      result = ""; // we have nothing to add, send nothing
    }
  }
  if (finalize != undefined) result = finalize(result);
  return new Response(JSON.stringify({ value: result }));
}

export async function POST(req) {
  let data = await req.request.json();
  return await do_post(
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
