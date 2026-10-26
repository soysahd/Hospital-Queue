const { query } = require('./db');

async function seedSchedules() {
  console.log('Seeding comprehensive doctor schedules for current & upcoming weeks...');
  const docs = await query('SELECT id, default_room_id FROM doctors');

  const today = new Date();
  
  for (let offset = -2; offset <= 21; offset++) {
    const d = new Date(today);
    d.setDate(today.getDate() + offset);
    const dateStr = d.toISOString().split('T')[0];
    const dayOfWeek = d.getDay(); // 0 = Sun, 6 = Sat

    for (let i = 0; i < docs.length; i++) {
      const doc = docs[i];
      let works = false;
      if (doc.id === 'doc-1' && dayOfWeek !== 0) works = true; // Mon-Sat
      else if (doc.id === 'doc-2' && dayOfWeek !== 0) works = true; // Mon-Sat
      else if (doc.id === 'doc-3' && dayOfWeek !== 1) works = true; // Tue-Sun
      else if (doc.id === 'doc-4' && [1, 3, 5].includes(dayOfWeek)) works = true; // Mon, Wed, Fri
      else if (doc.id === 'doc-5' && [2, 4, 6].includes(dayOfWeek)) works = true; // Tue, Thu, Sat
      else if (doc.id === 'doc-6' && dayOfWeek >= 1 && dayOfWeek <= 5) works = true; // Mon-Fri

      if (!works) continue;

      const scheduleId = `sched-${doc.id}-${dateStr}`;
      const startTime = '08:30';
      const endTime = '16:30';
      const breakStart = '12:30';
      const breakEnd = '13:30';
      const duration = 15;
      const capacity = 25;
      const status = 'AVAILABLE';

      await query(`
        INSERT INTO doctor_schedules (
          id, doctor_id, schedule_date, start_time, end_time, break_start, break_end,
          hospital_branch, room_id, appointment_duration, max_capacity, status, is_published, booking_disabled
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'Main Pavilion - Colombo', ?, ?, ?, ?, 1, 0)
        ON DUPLICATE KEY UPDATE start_time = VALUES(start_time), end_time = VALUES(end_time), is_published = 1
      `, [scheduleId, doc.id, dateStr, startTime, endTime, breakStart, breakEnd, doc.default_room_id, duration, capacity, status]);
    }
  }

  // Doctor avatar URLs
  const doctorAvatars = [
    'https://images.unsplash.com/photo-1622253692010-333f2da6031d?w=300&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1594824813627-9945dfef30ef?w=300&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1537368910025-700350fe46c7?w=300&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1612349317150-e413f6a5b16d?w=300&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1559839734-2b71ea197ec2?w=300&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1582750433449-648ed127bb54?w=300&auto=format&fit=crop&q=80'
  ];

  for (let i = 0; i < docs.length; i++) {
    const avatar = doctorAvatars[i % doctorAvatars.length];
    await query('UPDATE doctors SET profile_image = ? WHERE id = ?', [avatar, docs[i].id]);
  }

  console.log('Doctor schedules & profile pictures successfully initialized!');
}

if (require.main === module) {
  seedSchedules().then(() => process.exit(0)).catch(err => {
    console.error('Error seeding schedules:', err);
    process.exit(1);
  });
}

module.exports = seedSchedules;
