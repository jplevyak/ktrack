import { make_profile } from "../../_util.js";
import { profile } from "../_post.js";

function merge_profile(p1, p2) {
  p1 = { ...p1 }; // shallow copy
  p1.message = "";
  delete p1.authenticated;
  p2.username = p1.username;
  p2.authenticated = Date.now();
  p2.updated = p2.authenticated;
  if (p1.username == "" || p1.password == "") {
    p2.message = "profile created, authenticated";
    return p2;
  }
  if (p2.password != "" && p2.old_password != "" && p2.old_password != undefined) {
    if (p2.old_password != p1.password) {
      p1.message = "old password mismatch, not authenticated";
      p1.updated = Date.now();
      return p1;
    }
    p2.message = "new password saved, authenticated";
    return p2;
  }
  if (p1.password == p2.password) {
    p2.message = "profile in sync, authenticated";
    return p2;
  }
  p1.message = "incorrect password, not authenticated";
  p1.updated = Date.now();
  return p1;
}

export async function POST(req) {
  const data = await req.request.json();
  const username = data.username;

  let value;
  try {
    const dbValueStr = await profile.get(username);
    value = JSON.parse(dbValueStr);
  } catch (err) {
    if (err.code === "LEVEL_NOT_FOUND") {
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
      result = make_profile(); // request all
      delete result.updated;
    } else if (data.updated !== value.updated) {
      result = value; // send what we have
    } else {
      result = ""; // we are up to date, do nothing
    }
  } else {
    // update sent
    if (value !== undefined) {
      result = merge_profile(value, data.value);
    } else {
      result = data.value;
    }

    // store if we have nothing or if it is different
    if (value === undefined || data.updated < result.updated || result.updated !== value.updated) {
      const string_value = JSON.stringify(result);
      await profile.put(username, string_value);
    } else {
      result = ""; // we have nothing to add, send nothing
    }
  }

  // Remove the passwords from the response.
  if (result != undefined) {
    result.password = "";
    result.old_password = "";
  }

  return new Response(JSON.stringify({ value: result }));
}
