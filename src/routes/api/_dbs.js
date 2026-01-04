import LevelPkg from "level";
const { Level } = LevelPkg;

// Centralized database instances to avoid locking issues and allow sharing between endpoints
export const today = new Level("./today");
export const favorites = new Level("./favorites");
export const history = new Level("./history");
export const profile = new Level("./profile");
