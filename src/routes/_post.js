import LevelPkg from "level";
const { Level } = LevelPkg;
import { error } from "@sveltejs/kit";
import { CollabJSON, history_prune_limit } from "./_crdt.js";

export var profile = new Level("./profile");

async function do_post_internal(req, data, username, dbname, db, prune, defaultJSON) {
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

  let server_doc;

  if (!db_value_str && data.snapshot) {
      // Initialize from client snapshot
      server_doc = new CollabJSON(undefined, { clientId: 'server', id: data.docId });
      server_doc.root = data.snapshot;
      server_doc.snapshot = data.snapshot;
      server_doc.snapshotDvv = new Map(Object.entries(data.snapshotDvv || {}));
      server_doc.dvv = new Map(Object.entries(data.snapshotDvv || {}));
  } else if (!db_value_str) {
      // Initialize from default
      server_doc = new CollabJSON(defaultJSON, { clientId: 'server', id: data.docId });
  } else {
      // Load from DB
      server_doc = CollabJSON.fromJSON(JSON.parse(db_value_str), { clientId: 'server' });
  }

  // Allow special logic to run (e.g. for 'today' store) and handle pruning.
  // The 'prune' function is passed from the specific API endpoint.
  server_doc.prune(prune, data);

  // If the client's document ID doesn't match the server's, it means the client
  // has a fresh (e.g., post-login) or stale copy and needs to be reset with the
  // server's authoritative state.
  if (db_value_str && server_doc.id && data.docId && server_doc.id !== data.docId) {
    return new Response(JSON.stringify(server_doc.getResetResponse()));
  }

  const sync_response = server_doc.getSyncResponse(data);

  await db.put(username, JSON.stringify(server_doc.toJSON()));

  return new Response(JSON.stringify(sync_response));
}

export async function do_post(req, dbname, db, prune, defaultJSON) {
  // Check user and password.
  let data = await req.request.json();
  let username = data.username;
  let password = data.password;
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
  return await do_post_internal(req, data, username, dbname, db, prune, defaultJSON);
}
