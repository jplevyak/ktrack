import LevelPkg from "level";
const { Level } = LevelPkg;
import { error } from "@sveltejs/kit";
import { CollabJSON } from "../_crdt.js";

import { profile } from "./_dbs.js";

async function do_post_internal(req, syncRequest, username, dbname, db, prune, defaultJSON) {
  let db_value_str;
  try {
    db_value_str = await db.get(username);
  } catch (e) {
    // 'not-found' error indicates the key is not in the database
    if (e.code === "LEVEL_NOT_FOUND") {
      db_value_str = undefined;
    } else {
      throw e;
    }
  }

  let server_doc = CollabJSON.loadOrInit(db_value_str, syncRequest, defaultJSON);

  // Allow special logic to run (e.g. for 'today' store) and handle pruning.
  // The 'prune' function is passed from the specific API endpoint.
  server_doc.prune(prune, syncRequest);

  const sync_response = server_doc.getSyncResponse(syncRequest);

  await db.put(username, JSON.stringify(server_doc.toJSON()));

  return new Response(JSON.stringify(sync_response));
}

export async function do_post(req, dbname, db, prune, defaultJSON) {
  // Check user and password.
  let syncRequest = await req.request.json();
  let username = syncRequest.username;
  let password = syncRequest.password;
  if (username == undefined || !username || typeof username.valueOf() !== "string") {
    console.log("bad username");
    return new Response(JSON.stringify({ err: "bad username" }));
  }
  if (password == undefined || !password || typeof password.valueOf() !== "string") {
    console.log("bad password");
    return new Response(JSON.stringify({ err: "bad password" }));
  }
  let p;
  try {
    const value = await profile.get(username);
    p = JSON.parse(value);
  } catch (e) {
    if (e.code === "LEVEL_NOT_FOUND" || e instanceof SyntaxError) {
      // User doesn't exist or has corrupt data. Create a new profile.
      p = {
        username: username,
        password: password,
        old_password: "",
        message: "profile created, authenticated",
        authenticated: Date.now(),
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

export async function do_upload(req, dbname, db, prune, defaultJSON) {
  const authHeader = req.request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Basic ")) {
    return new Response(JSON.stringify({ err: "Missing or invalid Authorization header" }), {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="KTrack"' },
    });
  }

  const base64Credentials = authHeader.split(" ")[1];
  const credentials = atob(base64Credentials);
  const [username, password] = credentials.split(":");

  if (!username || !password) {
    return new Response(JSON.stringify({ err: "Invalid credentials format" }), { status: 401 });
  }

  let p;
  try {
    const value = await profile.get(username);
    p = JSON.parse(value);
  } catch (e) {
    return new Response(JSON.stringify({ err: "Authentication failed" }), { status: 401 });
  }

  if (p.username != username || p.password != password) {
    return new Response(JSON.stringify({ err: "Authentication failed" }), { status: 401 });
  }

  let data;
  try {
    data = await req.request.json();
  } catch (e) {
    return new Response(JSON.stringify({ err: "Invalid JSON body" }), { status: 400 });
  }

  let db_value_str;
  try {
    db_value_str = await db.get(username);
  } catch (e) {
    if (e.code === "LEVEL_NOT_FOUND") {
      db_value_str = undefined;
    } else {
      throw e;
    }
  }

  let server_doc = CollabJSON.loadOrInit(db_value_str, null, defaultJSON, { clientId: "server" });

  // Only update if the data has actually changed. This prevents generating redundant operations
  // (and thus redundant sync traffic) if the upload endpoint is called repeatedly with the same data.
  const currentData = server_doc.getData();
  if (JSON.stringify(currentData) !== JSON.stringify(data)) {
    server_doc.replaceData(data);
    await db.put(username, JSON.stringify(server_doc.toJSON()));
  }


}

export async function do_sync_batch(req, dbs, prunes, defaults) {
  let body = await req.request.json();
  const { username, password, requests } = body;

  if (username == undefined || !username || typeof username.valueOf() !== "string") {
    return new Response(JSON.stringify({ err: "bad username" }));
  }
  if (password == undefined || !password || typeof password.valueOf() !== "string") {
    return new Response(JSON.stringify({ err: "bad password" }));
  }

  let p;
  try {
    const value = await profile.get(username);
    p = JSON.parse(value);
  } catch (e) {
    if (e.code === "LEVEL_NOT_FOUND" || e instanceof SyntaxError) {
      p = {
        username: username,
        password: password,
        old_password: "",
        message: "profile created, authenticated",
        authenticated: Date.now(),
      };
      await profile.put(username, JSON.stringify(p));
    } else {
      console.log("Error retrieving profile for user:", username, e);
      return new Response(JSON.stringify({ err: "Error reading profile" }));
    }
  }

  if (p.username != username || p.password != password) {
    return new Response(JSON.stringify({ err: "incorrect password" }));
  }

  const responses = {};
  const promises = [];

  for (const [key, syncRequest] of Object.entries(requests)) {
    const db = dbs[key];
    const prune = prunes[key] || ((x) => x);
    const defaultJSON = defaults[key] || "{}";

    if (db) {
      promises.push(
        do_post_internal({ request: { json: async () => syncRequest } }, syncRequest, username, key, db, prune, defaultJSON)
          .then(async (res) => {
            const json = await res.json();
            responses[key] = json;
          })
          .catch((err) => {
            console.error(`Error processing batch item ${key}:`, err);
            responses[key] = { err: "Internal server error" };
          })
      );
    }
  }

  await Promise.all(promises);
  return new Response(JSON.stringify(responses));
}

