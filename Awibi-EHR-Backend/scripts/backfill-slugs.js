/**
 * Give every facility a stored slug.
 *
 * Slugs used to be derived from the facility name on each request. Storing them
 * means a rename no longer breaks links a facility has already published, and
 * two facilities with the same name no longer collide on one public page.
 *
 * Safe to run repeatedly: facilities that already have a slug are left alone.
 */
const { PrismaClient } = require('@prisma/client');

const db = new PrismaClient();

function slugify(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

(async () => {
  const facilities = await db.facility.findMany({
    where: { slug: null },
    select: { id: true, name: true, phone: true },
  });

  const taken = new Set(
    (await db.facility.findMany({ where: { slug: { not: null } }, select: { slug: true } }))
      .map((f) => f.slug),
  );

  for (const facility of facilities) {
    const base = slugify(facility.name) || 'clinic';
    let slug = base;
    // Two facilities can legitimately share a name — a chain with two branches,
    // for instance — so the second one gets a numbered slug rather than failing.
    for (let n = 2; taken.has(slug); n += 1) slug = `${base}-${n}`;
    taken.add(slug);

    await db.facility.update({
      where: { id: facility.id },
      data: {
        slug,
        // Seed the public contact number from the facility's own number so the
        // page is usable immediately; staff can change it in settings.
        receptionPhone: facility.phone || undefined,
      },
    });
    console.log(`  ${facility.name} -> /clinic/${slug}`);
  }

  console.log(`\n${facilities.length} facilit${facilities.length === 1 ? 'y' : 'ies'} given a stored slug`);
  await db.$disconnect();
})();
