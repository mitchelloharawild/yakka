/**
 * Demo data: `npm run db:seed`. Creates a fresh demo group each run (it never
 * deletes anything) and prints its group URL and a tag URL.
 */
import "dotenv/config";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { newTagToken } from "@/lib/ids";
import { completeChore } from "@/lib/services/completions";
import { createChore } from "@/lib/services/chores";
import { createGroup } from "@/lib/services/groups";
import { fromWallClock, toWallClock } from "@/lib/schedule";

const TZ = "Australia/Sydney";

/** Today's local date in TZ at hh:mm, as an instant. */
function todayAt(hours: number, minutes = 0, dayOffset = 0): Date {
  const w = toWallClock(new Date(), TZ);
  return fromWallClock(
    new Date(Date.UTC(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate() + dayOffset, hours, minutes)),
    TZ,
  );
}

async function main() {
  const group = await createGroup({
    name: "Demo household",
    timezone: TZ,
    members: [
      { name: "Alex", colour: "#e11d48" },
      { name: "Sam", colour: "#2563eb" },
      { name: "Jo", colour: "#16a34a" },
    ],
  });
  const [alex, sam] = group.members;

  const bins = await createChore(group.id, {
    title: "Take the bins out",
    icon: "🗑️",
    rrule: "FREQ=WEEKLY;BYDAY=TU",
    startsAt: todayAt(19, 0, -14),
    anchor: "DUE_DATE",
    assigneeMode: "ROUND_ROBIN",
    graceMinutes: 12 * 60,
  });
  const plants = await createChore(group.id, {
    title: "Water the plants",
    icon: "🪴",
    rrule: "FREQ=DAILY;INTERVAL=3",
    startsAt: todayAt(8, 0, -10),
    anchor: "COMPLETION",
    graceMinutes: 24 * 60,
  });
  await createChore(group.id, {
    title: "Feed the cat",
    icon: "🐈",
    rrule: "FREQ=DAILY",
    startsAt: todayAt(7, 30, -30),
    anchor: "DUE_DATE",
    graceMinutes: 90,
  });
  await createChore(group.id, {
    title: "Clean the bathroom",
    icon: "🛁",
    rrule: "FREQ=WEEKLY;BYDAY=SA",
    startsAt: todayAt(10, 0, -21),
    anchor: "DUE_DATE",
    assigneeMode: "FIXED",
    assigneeId: sam.id,
    graceMinutes: 24 * 60,
  });
  await createChore(group.id, {
    title: "Descale the kettle",
    icon: "☕",
    startsAt: todayAt(18, 0, 7),
  });

  // Some history.
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 3600_000);
  await completeChore({ choreId: plants.id, memberId: alex.id, source: "MANUAL", completedAt: threeDaysAgo });
  await completeChore({
    choreId: bins.id,
    memberId: sam.id,
    source: "MANUAL",
    completedAt: new Date(Date.now() - 6 * 24 * 3600_000),
  });

  const tag = await prisma.tag.create({
    data: { token: newTagToken(), groupId: group.id, choreId: bins.id, qr: true, nfc: true, label: "Bin cupboard" },
  });

  const base = env().BASE_URL;
  console.log(`Group: ${base}/groups/${group.id}`);
  console.log(`Tag:   ${base}/t/${tag.token}  (${bins.title})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
