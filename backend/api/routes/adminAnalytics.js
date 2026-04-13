import express from "express";
import { pool } from "../db.js";
import { requireAdmin } from "../lib/authMiddleware.js";

const router = express.Router();

function getCount(rows) {
    return Array.isArray(rows) && rows.length > 0 ? rows[0].count ?? 0 : 0;
}

router.get("/", requireAdmin, async (_req, res) => {
    try {
        /*
            Get the start of the current month and the start of next month
            so month-based analytics use a clean date range.
        */
        const [[monthBounds]] = await pool.query(`
            SELECT
                DATE_FORMAT(CURDATE(), '%Y-%m-01') AS monthStart,
                DATE_ADD(LAST_DAY(CURDATE()), INTERVAL 1 DAY) AS nextMonthStart
        `);

        const { monthStart, nextMonthStart } = monthBounds;

        /*
            1. All Time Registered Users
            Assumes every registered account is stored in customer
        */
        const [allTimeUsersRows] = await pool.query(`
            SELECT COUNT(*) AS count
            FROM customer
        `);

        /*
            2. All Time Reservations
            Assumes each reservation is stored in appointment
        */
        const [allTimeReservationsRows] = await pool.query(`
            SELECT COUNT(*) AS count
            FROM appointment
        `);

        /*
            3. Reservations Made This Month
            This should mean appointments created this month, not appointments scheduled in the month.
        */
        const [reservationsThisMonthRows] = await pool.query(
            `
            SELECT COUNT(*) AS count
            FROM appointment
            WHERE createdAt >= ? AND createdAt < ?
            `,
            [monthStart, nextMonthStart]
        );

        /*
            4. Unique Users This Month
            Count the actual booking users from appointment.userID so this works even if pet profile logic changes.
        */
        const [uniqueUsersThisMonthRows] = await pool.query(
            `
            SELECT COUNT(DISTINCT a.userID) AS count
            FROM appointment a
            WHERE a.createdAt >= ? AND a.createdAt < ?
            `,
            [monthStart, nextMonthStart]
        );

        /*
            5. Top Three Requested Items This Month
            Assumes appointment.reasonKey stores the request/service type.
        */
        const [topThreeRequestedItemsThisMonth] = await pool.query(
            `
            SELECT
                a.reasonKey AS label,
                COUNT(*) AS count
            FROM appointment a
            WHERE a.createdAt >= ? AND a.createdAt < ?
            GROUP BY a.reasonKey
            ORDER BY count DESC, label ASC
            LIMIT 3
            `,
            [monthStart, nextMonthStart]
        );

        /*
            6. Top Three Staff This Month
            Assumes appointment_staff links staff to appointments.
            Assumes staff names come from customer via staff.userID.
        */
        const [topThreeStaffThisMonth] = await pool.query(
            `
            SELECT
                s.staffID,
                COALESCE(
                    CONCAT(c.legalFirstName, ' ', c.legalLastName),
                    CONCAT('Staff #', s.staffID)
                ) AS label,
                COUNT(*) AS count
            FROM appointment_staff aps
            JOIN appointment a ON aps.appointmentID = a.appointmentID
            JOIN staff s ON aps.staffID = s.staffID
            LEFT JOIN customer c ON s.userID = c.userID
            WHERE a.createdAt >= ? AND a.createdAt < ?
            GROUP BY s.staffID, c.legalFirstName, c.legalLastName
            ORDER BY count DESC, label ASC
            LIMIT 3
            `,
            [monthStart, nextMonthStart]
        );

        /*
            7. Top Three Users This Month
            Use appointment.userID as the booking owner so the count matches who actually made the reservation.
        */
        const [topThreeUsersThisMonth] = await pool.query(
            `
            SELECT
                c.userID,
                COALESCE(
                    CONCAT(c.legalFirstName, ' ', c.legalLastName),
                    CONCAT('User #', c.userID)
                ) AS label,
                COUNT(*) AS count
            FROM appointment a
            JOIN customer c ON a.userID = c.userID
            WHERE a.createdAt >= ? AND a.createdAt < ?
            GROUP BY c.userID, c.legalFirstName, c.legalLastName
            ORDER BY count DESC, label ASC
            LIMIT 3
            `,
            [monthStart, nextMonthStart]
        );

        /*
            8. Total Cancellations
            Assumes Sprint 5 schema includes appointment.isCanceled.
        */
        const [totalCancellationsRows] = await pool.query(`
            SELECT COUNT(*) AS count
            FROM appointment
            WHERE isCanceled = 1
        `);

        /*
            9. Cancellations This Month
            Assumes appointment_cancellation exists and canceledAt stores timestamp.
        */
        const [cancellationsThisMonthRows] = await pool.query(
            `
            SELECT COUNT(*) AS count
            FROM appointment_cancellation
            WHERE canceledAt >= ? AND canceledAt < ?
            `,
            [monthStart, nextMonthStart]
        );

        /*
            10. Cancellations This Month by Category
            Assumes appointment_cancellation.canceledByType stores who canceled it,
            such as Admin, Staff, or User.
        */
        const [cancellationsThisMonthByCategory] = await pool.query(
            `
            SELECT
                canceledByType AS category,
                COUNT(*) AS count
            FROM appointment_cancellation
            WHERE canceledAt >= ? AND canceledAt < ?
            GROUP BY canceledByType
            ORDER BY count DESC, category ASC
            `,
            [monthStart, nextMonthStart]
        );

        res.json({
            allTimeRegisteredUsers: getCount(allTimeUsersRows),
            allTimeReservations: getCount(allTimeReservationsRows),
            reservationsMadeThisMonth: getCount(reservationsThisMonthRows),
            uniqueUsersThisMonth: getCount(uniqueUsersThisMonthRows),
            topThreeRequestedItemsThisMonth,
            topThreeStaffThisMonth,
            topThreeUsersThisMonth,
            totalCancellations: getCount(totalCancellationsRows),
            cancellationsThisMonth: getCount(cancellationsThisMonthRows),
            cancellationsThisMonthByCategory,
        });
    } catch (error) {
        console.error("[adminAnalytics] failed to load analytics", error);
        res.status(500).json({ message: "failed to load analytics" });
    }
});

export default router;