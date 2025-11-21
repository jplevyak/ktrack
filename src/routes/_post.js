import LevelPkg from "level";
const { Level } = LevelPkg;
import { error } from "@sveltejs/kit";
import { CollabJSON, history_prune_limit } from "./_crdt.js";

export var profile = new Level("./profile");

async function do_post_internal(req, syncRequest, username, dbname, db, prune, defaultJSON) {
  let db_value_str;
  try {
    db_value_str = await db.get(username);
  } catch (e) {
    // 'not-found' error indicates the key is not in the database
    if (e.code === 'LEVEL_NOT_FOUND') {
      db_value_str = undefined;
    } else {
      throw e;
    }
  }

  let server_doc = CollabJSON.loadOrInit(db_value_str, syncRequest, defaultJSON);

  // Allow special logic to run (e.g. for 'today' store) and handle pruning.
  // The 'prune' function is passed from the specific API endpoint.
  server_doc.prune(prune, syncRequest);

  // If the client's document ID doesn't match the server's, it means the client
  // has a fresh (e.g., post-login) or stale copy and needs to be reset with the
  // server's authoritative state.
  if (db_value_str && server_doc.id && syncRequest.docId && server_doc.id !== syncRequest.docId) {
    return new Response(JSON.stringify(server_doc.getResetResponse()));
  }

  const sync_response = server_doc.getSyncResponse(syncRequest);

  await db.put(username, JSON.stringify(server_doc.toJSON()));

  return new Response(JSON.stringify(sync_response));
}

export async function do_post(req, dbname, db, prune, defaultJSON) {
  // Check user and password.
  let syncRequest = await req.request.json();
  let username = syncRequest.username;
  let password = syncRequest.password;
  if (
    username == undefined ||
    !username ||
    typeof username.valueOf() !== "string"
  ) {
    console.log("bad username");
    return new Response(JSON.stringify({ err: "bad username" }));
  }
  if (
    password == undefined ||
    !password ||
    typeof password.valueOf() !== "string"
  ) {
    console.log("bad password");
    return new Response(JSON.stringify({ err: "bad password" }));
  }
  let p;
  try {
    const value = await profile.get(username);
    p = JSON.parse(value);
  } catch (e) {
    if (e.code === 'LEVEL_NOT_FOUND' || e instanceof SyntaxError) {
      // User doesn't exist or has corrupt data. Create a new profile.
      p = {
        username: username,
        password: password,
        old_password: "",
        message: "profile created, authenticated",
        authenticated: Date.now()
      };
      await profile.put(username, JSON.stringify(p));
    } else {
      // Some other DB error.
      console.log("Error retrieving profile for user:", username, e);
      return new Response(JSON.stringify({ err: "Error reading profile" }));
    }
  }

  if (p.username != username || p.password != password) {
    console.log("incorrect password");
    return new Response(JSON.stringify({ err: "incorrect password" }));
  }
  return await do_post_internal(req, syncRequest, username, dbname, db, prune, defaultJSON);
}
