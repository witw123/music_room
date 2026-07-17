import { PrismaClient } from "../generated/prisma/index";

const prisma = new PrismaClient();
const args = process.argv.slice(2);
const username = readArg("--username");
const role = readArg("--role");
const force = args.includes("--force");

if (!username || (role !== "ADMIN" && role !== "USER")) {
  throw new Error("Usage: admin:role -- --username <name> --role ADMIN|USER [--force]");
}

void run();
async function run() {
  try {
    const user = await prisma.user.findUnique({ where: { username: username!.trim().toLowerCase() } });
    if (!user) throw new Error("User not found.");
    if (role === "USER" && user.role === "ADMIN" && !force) {
      const count = await prisma.user.count({ where: { role: "ADMIN", status: "ACTIVE" } });
      if (count <= 1) throw new Error("Refusing to demote the last active administrator without --force.");
    }
    await prisma.user.update({ where: { id: user.id }, data: { role: role as "ADMIN" | "USER" } });
    console.log(`Updated ${user.username} role to ${role}.`);
  } finally {
    await prisma.$disconnect();
  }
}

function readArg(name: string) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}
