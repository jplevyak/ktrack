import { merge_profile, make_profile } from "../../_util.js";
import { profile } from "../../_post.js";

function finalize_profile(p) {
  if (p != undefined) {
    p.password = "";
    p.old_password = "";
  }
  return p;
}

export async function POST(req) {
  const data = await req.request.json();
  const username = data.username;
  const db = profile;
  const merge = merge_profile;
  const make = make_profile;
  const finalize = finalize_profile;

  let value;
  try {
    const dbValueStr = await db.get(username);
    value = JSON.parse(dbValueStr);
  } catch (err) {
    if (err.code === 'LEVEL_NOT_FOUND') {
      value = undefined;
    } else if (err instanceof SyntaxError) {
      console.log("bad json");
      value = undefined;
    } else {
      // For other DB errors, etc., rethrow.
      throw err;
    }
  }

  let result = ""; // request nothing.

  if (data.value === undefined) {
    // nothing sent and/or status request
    if (value === undefined) {
      result = make(); // request all
      delete result.updated;
    } else if (data.updated !== value.updated) {
      result = value; // send what we have
    } else {
      result = ""; // we are up to date, do nothing
    }
  } else {
    // update sent
    if (value !== undefined) {
      result = merge(value, data.value);
    } else {
      result = data.value;
    }

    // store if we have nothing or if it is different
    if (value === undefined || data.updated < result.updated || result.updated !== value.updated) {
      const string_value = JSON.stringify(result);
      await db.put(username, string_value);
    } else {
      result = ""; // we have nothing to add, send nothing
    }
  }

  if (finalize) {
    result = finalize(result);
  }

  return new Response(JSON.stringify({ value: result }));
}
