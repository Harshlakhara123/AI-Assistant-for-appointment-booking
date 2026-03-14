export const schedule = {
    "2026-03-15": {
        "Dr. Sharma": ["10:00 AM", "02:00 PM"],
        "Dr. Smith": ["11:30 AM", "04:00 PM"]
    },
    "2026-03-16": {
        "Dr. Sharma": ["09:00 AM", "01:00 PM"],
        "Dr. Smith": ["03:00 PM"]
    }
};

export const bookings: Array<{ id: string, patient: string, date: string, time: string, doctor: string }> = [];

export function checkAvailability(date: string) {
    console.log(`[DB] Checking availability for ${date}`);
    const daySchedule = schedule[date as keyof typeof schedule];
    if (!daySchedule) return { status: "unavailable", message: "No doctors available on this date." };
    return { status: "available", data: daySchedule };
}

export function bookAppointment(patientName: string, date: string, time: string, doctor: string) {
    console.log(`[DB] Booking ${patientName} with ${doctor} on ${date} at ${time}`);

    const availableSlots = schedule[date as keyof typeof schedule]?.[doctor as keyof typeof schedule["2026-03-15"]];
    if (!availableSlots || !availableSlots.includes(time)) {
        return { status: "error", message: "Slot unavailable or double-booked." };
    }

    const index = availableSlots.indexOf(time);
    availableSlots.splice(index, 1);
    bookings.push({ id: Math.random().toString(36).substring(7), patient: patientName, date, time, doctor });

    return { status: "success", message: "Appointment booked successfully." };
}