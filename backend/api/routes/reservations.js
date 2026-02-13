function buildSlotUsage(appts) {
  const usage = {};

  for (const a of appts) {
    // Supports both shapes:
    // 1) from fetchAppointmentsInRange: { dateStr, startTime, reasonKey }
    // 2) from FOR UPDATE query:        { startAt, reasonKey }
    let dateStr = "";
    let startTime = "";

    if (a.dateStr && a.startTime) {
      dateStr = String(a.dateStr);
      startTime = String(a.startTime).slice(0, 5); // "HH:MM"
    } else if (a.startAt) {
      // handle mysql DATETIME string "YYYY-MM-DD HH:MM:SS"
      const raw = String(a.startAt);
      if (raw.includes(" ")) {
        const [d, t] = raw.split(" ");
        dateStr = d;
        startTime = t.slice(0, 5);
      } else {
        const dt = new Date(raw);
        if (!Number.isNaN(dt.getTime())) {
          dateStr = toDateOnlyUTC(dt);
          startTime = `${pad2(dt.getUTCHours())}:${pad2(dt.getUTCMinutes())}`;
        }
      }
    }

    if (!dateStr || !startTime) continue;

    const rk = normalizeReasonKey(a.reasonKey);
    const req = REASON_REQUIREMENTS[rk];
    if (!req) continue;

    const sk = slotKey(dateStr, startTime);
    if (!usage[sk]) usage[sk] = { rooms: {}, equipment: {} };

    for (const [rtype, units] of Object.entries(req.rooms)) {
      const rr = normalizeResourceKey(rtype);
      usage[sk].rooms[rr] = (usage[sk].rooms[rr] || 0) + Number(units);
    }
    for (const [etype, units] of Object.entries(req.equipment)) {
      const ee = normalizeResourceKey(etype);
      usage[sk].equipment[ee] = (usage[sk].equipment[ee] || 0) + Number(units);
    }
  }

  return usage;
}
