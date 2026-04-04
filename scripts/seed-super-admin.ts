/**
 * Seed script: creates or updates the super admin mobile user (role: admin).
 * Usage: npx tsx scripts/seed-super-admin.ts
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "../shared/schema";
import { users } from "../shared/schema";
import { eq } from "drizzle-orm";

const pool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL || process.env.DATABASE_URL });
const db = drizzle(pool, { schema });

const EMAIL = "kidspotbrasil@gmail.com";
const PASSWORD = "102030";
const NAME = "KidSpot Brasil";

async function main() {
  const password_hash = await bcrypt.hash(PASSWORD, 10);

  const existing = await db.query.users.findFirst({
    where: eq(users.email, EMAIL.toLowerCase()),
  });

  if (existing) {
    await db
      .update(users)
      .set({ password_hash, role: "admin" })
      .where(eq(users.email, EMAIL.toLowerCase()));
    console.log(`Admin atualizado: ${EMAIL}`);
  } else {
    await db.insert(users).values({
      name: NAME,
      email: EMAIL.toLowerCase(),
      password_hash,
      role: "admin",
    });
    console.log(`Admin criado: ${EMAIL}`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
