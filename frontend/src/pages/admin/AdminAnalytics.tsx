import { useEffect, useState } from "react";

type AnalyticsListItem = {
    label: string;
    count: number;
};

type CancellationCategoryItem = {
    category: string;
    count: number;
};

type AdminAnalyticsData = {
    allTimeRegisteredUsers: number;
    allTimeReservations: number;
    reservationsThisMonth: number;
    uniqueUsersThisMonth: number;
    topThreeRequestedItemsThisMonth: AnalyticsListItem[];
    topThreeStaffThisMonth: AnalyticsListItem[];
    topThreeUsersThisMonth: AnalyticsListItem[];
    totalCancellations: number;
    cancellationsThisMonth: number;
    cancellationsThisMonthByCategory: CancellationCategoryItem[];
};

export default function AdminAnalytics() {
    const [analytics, setAnalytics] = useState<AdminAnalyticsData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
        let alive = true;

        (async () => {
            try {
                setLoading(true);
                setError("");

                const response = await fetch("/api/admin/analytics", {
                    credentials: "include",
                });

                if (!response.ok) {
                    throw new Error("Failed to load analytics data.");
                }

                const data: AdminAnalyticsData = await response.json();

                if (!alive) return;
                setAnalytics(data);
            } catch (err) {
                if (!alive) return;
                setError(err instanceof Error ? err.message : "Failed to load analytics data.");
            } finally {
                if (!alive) return;
                setLoading(false);
            }
        })();

        return () => {
            alive = false;
        };
    }, []);

    if (loading) {
        return (
            <div>
                <h1>View Analytics</h1>
                <p>Loading analytics data...</p>
            </div>
        );
    }

    if (error || !analytics) {
        return (
            <div>
                <h1>View Analytics</h1>
                <p>{error || "Analytics data is unavailable."}</p>
            </div>
        );
    }

    return (
        <div>
            <h1>View Analytics</h1>
            <p>Admin analytics dashboard for Sprint 5 metrics.</p>

            <div style={{ display: "grid", gap: "16px", marginTop: "20px" }}>
                <section
                    style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                        gap: "16px",
                    }}
                >
                    <div style={{ border: "1px solid #ccc", borderRadius: "12px", padding: "16px" }}>
                        <h2>All Time Registered Users</h2>
                        <p>{analytics.allTimeRegisteredUsers}</p>
                    </div>

                    <div style={{ border: "1px solid #ccc", borderRadius: "12px", padding: "16px" }}>
                        <h2>All Time Reservations</h2>
                        <p>{analytics.allTimeReservations}</p>
                    </div>

                    <div style={{ border: "1px solid #ccc", borderRadius: "12px", padding: "16px" }}>
                        <h2>Reservations This Month</h2>
                        <p>{analytics.reservationsThisMonth}</p>
                    </div>

                    <div style={{ border: "1px solid #ccc", borderRadius: "12px", padding: "16px" }}>
                        <h2>Unique Users This Month</h2>
                        <p>{analytics.uniqueUsersThisMonth}</p>
                    </div>

                    <div style={{ border: "1px solid #ccc", borderRadius: "12px", padding: "16px" }}>
                        <h2>Total Cancellations</h2>
                        <p>{analytics.totalCancellations}</p>
                    </div>

                    <div style={{ border: "1px solid #ccc", borderRadius: "12px", padding: "16px" }}>
                        <h2>Cancellations This Month</h2>
                        <p>{analytics.cancellationsThisMonth}</p>
                    </div>
                </section>

                <section style={{ border: "1px solid #ccc", borderRadius: "12px", padding: "16px" }}>
                    <h2>Top Three Requested Items This Month</h2>
                    <ol>
                        {analytics.topThreeRequestedItemsThisMonth.map((item) => (
                            <li key={item.label}>
                                {item.label} ({item.count})
                            </li>
                        ))}
                    </ol>
                </section>

                <section style={{ border: "1px solid #ccc", borderRadius: "12px", padding: "16px" }}>
                    <h2>Top Three Staff This Month</h2>
                    <ol>
                        {analytics.topThreeStaffThisMonth.map((staff) => (
                            <li key={staff.label}>
                                {staff.label} ({staff.count})
                            </li>
                        ))}
                    </ol>
                </section>

                <section style={{ border: "1px solid #ccc", borderRadius: "12px", padding: "16px" }}>
                    <h2>Top Three Users This Month</h2>
                    <ol>
                        {analytics.topThreeUsersThisMonth.map((user) => (
                            <li key={user.label}>
                                {user.label} ({user.count})
                            </li>
                        ))}
                    </ol>
                </section>

                <section style={{ border: "1px solid #ccc", borderRadius: "12px", padding: "16px" }}>
                    <h2>Cancellations This Month by Category</h2>
                    <ul>
                        {analytics.cancellationsThisMonthByCategory.map((item) => (
                            <li key={item.category}>
                                {item.category}: {item.count}
                            </li>
                        ))}
                    </ul>
                </section>
            </div>
        </div>
    );
}