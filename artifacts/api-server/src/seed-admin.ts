import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { db, pool } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

async function seedAdmin() {
  const email = "admin@quailvalleyhoa.org";
  const existing = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (existing.length > 0) {
    console.log("Admin user already exists, skipping seed.");
    await pool.end();
    return;
  }

  const password = process.env.ADMIN_PASSWORD ?? randomBytes(12).toString("hex");
  const passwordHash = await bcrypt.hash(password, 12);
  await db.insert(usersTable).values({
    email,
    passwordHash,
    role: "admin",
    name: "Admin",
    pending: false,
    boardMember: true,
    createdAt: new Date().toISOString(),
  });

  console.log("Admin user created:");
  console.log("  Email:   ", email);
  console.log("  Password:", password);
  console.log("  (Set ADMIN_PASSWORD env var before seeding to choose your own password)");
  await pool.end();
}

seedAdmin().catch((err) => {
  console.error("Seed error:", err);
  process.exit(1);
});
