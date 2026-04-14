import { useEffect, useMemo, useState } from "react";
import "../../styles/adminLayout.css";

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
	reservationsMadeThisMonth: number;
	uniqueUsersThisMonth: number;
	topThreeRequestedItemsThisMonth: AnalyticsListItem[];
	topThreeStaffThisMonth: AnalyticsListItem[];
	topThreeUsersThisMonth: AnalyticsListItem[];
	totalCancellations: number;
	cancellationsThisMonth: number;
	cancellationsThisMonthByCategory: CancellationCategoryItem[];
};

function formatCancelCategory(category: string) {
	// Make backend category values look readable in the UI
	return String(category || "").trim().toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase()) || "Unknown";
}

function buildListItems(items: AnalyticsListItem[] | CancellationCategoryItem[], labelBuilder: (item: any) => string) {
	// Keep empty analytics sections readable instead of rendering blank lists
	if (!items.length) return <p className="adminAnalyticsEmptyText">No data yet</p>;

	return (
		<ol className="adminAnalyticsList">
			{items.map((item) => (
				<li key={labelBuilder(item)}>{labelBuilder(item)}</li>
			))}
		</ol>
	);
}

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

				const response = await fetch("/api/admin/analytics", { credentials: "include" });
				if (!response.ok) throw new Error("Failed to load analytics data");

				const data: AdminAnalyticsData = await response.json();
				if (!alive) return;
				setAnalytics(data);
			} catch (err) {
				if (!alive) return;
				setError(err instanceof Error ? err.message : "Failed to load analytics data");
			} finally {
				if (!alive) return;
				setLoading(false);
			}
		})();

		return () => {
			alive = false;
		};
	}, []);

	const topAppointmentTypeItems = useMemo(() => analytics?.topThreeRequestedItemsThisMonth || [], [analytics]);
	const topStaffItems = useMemo(() => analytics?.topThreeStaffThisMonth || [], [analytics]);
	const topUserItems = useMemo(() => analytics?.topThreeUsersThisMonth || [], [analytics]);
	const cancelCategoryItems = useMemo(() => analytics?.cancellationsThisMonthByCategory || [], [analytics]);

	if (loading) {
		return (
			<div className="adminAnalyticsPage">
				<div className="adminAnalyticsHeader">
					<h1 className="adminAnalyticsTitle">View Analytics</h1>
					<p className="adminAnalyticsSubtitle">Admin appointment analytics</p>
				</div>
				<p className="adminAnalyticsMessage">Loading analytics data...</p>
			</div>
		);
	}

	if (error || !analytics) {
		return (
			<div className="adminAnalyticsPage">
				<div className="adminAnalyticsHeader">
					<h1 className="adminAnalyticsTitle">View Analytics</h1>
					<p className="adminAnalyticsSubtitle">Admin appointment analytics</p>
				</div>
				<p className="adminAnalyticsMessageError">{error || "Analytics data is unavailable"}</p>
			</div>
		);
	}

	return (
		<div className="adminAnalyticsPage">
			<div className="adminAnalyticsHeader">
				<h1 className="adminAnalyticsTitle">View Analytics</h1>
				<p className="adminAnalyticsSubtitle">Admin appointment analytics for the current system state</p>
			</div>

			<div className="adminAnalyticsStatsGrid">
				<div className="adminAnalyticsCard">
					<h2 className="adminAnalyticsMetricLabel">All Time Registered Users</h2>
					<p className="adminAnalyticsMetricValue">{analytics.allTimeRegisteredUsers}</p>
				</div>

				<div className="adminAnalyticsCard">
					<h2 className="adminAnalyticsMetricLabel">All Time Appointments</h2>
					<p className="adminAnalyticsMetricValue">{analytics.allTimeReservations}</p>
				</div>

				<div className="adminAnalyticsCard">
					<h2 className="adminAnalyticsMetricLabel">Appointments Made This Month</h2>
					<p className="adminAnalyticsMetricValue">{analytics.reservationsMadeThisMonth}</p>
				</div>

				<div className="adminAnalyticsCard">
					<h2 className="adminAnalyticsMetricLabel">Unique Users This Month</h2>
					<p className="adminAnalyticsMetricValue">{analytics.uniqueUsersThisMonth}</p>
				</div>

				<div className="adminAnalyticsCard">
					<h2 className="adminAnalyticsMetricLabel">Total Cancellations</h2>
					<p className="adminAnalyticsMetricValue">{analytics.totalCancellations}</p>
				</div>

				<div className="adminAnalyticsCard">
					<h2 className="adminAnalyticsMetricLabel">Cancellations This Month</h2>
					<p className="adminAnalyticsMetricValue">{analytics.cancellationsThisMonth}</p>
				</div>
			</div>

			<div className="adminAnalyticsListCard">
				<h2 className="adminAnalyticsListTitle">Top Three Appointments Made This Month</h2>
				{buildListItems(topAppointmentTypeItems, (item) => `${item.label} (${item.count})`)}
			</div>

			<div className="adminAnalyticsListCard">
				<h2 className="adminAnalyticsListTitle">Top Three Staff This Month</h2>
				{buildListItems(topStaffItems, (item) => `${item.label} (${item.count})`)}
			</div>

			<div className="adminAnalyticsListCard">
				<h2 className="adminAnalyticsListTitle">Top Three Users This Month</h2>
				{buildListItems(topUserItems, (item) => `${item.label} (${item.count})`)}
			</div>

			<div className="adminAnalyticsListCard">
				<h2 className="adminAnalyticsListTitle">Cancellations This Month By Category</h2>
				{buildListItems(cancelCategoryItems, (item) => `${formatCancelCategory(item.category)} (${item.count})`)}
			</div>
		</div>
	);
}
