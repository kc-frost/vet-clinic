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

type ReviewExtreme = {
	appointmentID: number;
	rating: number;
	reviewText?: string | null;
	reasonKey: string;
	date: string;
	petName?: string | null;
	customerName?: string | null;
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
	allTimeAverageRating: number | null;
	monthlyAverageRating: number | null;
	highestScoringReservationOfMonth: ReviewExtreme | null;
	lowestScoringReservationOfMonth: ReviewExtreme | null;
};

function formatCancelCategory(category: string) {
	// Make backend category values look readable in the UI
	return String(category || "").trim().toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase()) || "Unknown";
}

function formatRating(value: number | string | null) {
	if (value === null || value === undefined) return "No ratings";

	const rating = Number(value);
	if (!Number.isFinite(rating)) return "No ratings";

	return `${rating.toFixed(2)} / 5`;
}

function formatDate(value: string) {
	if (!value) return "Unknown date";

	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;

	return date.toLocaleString([], { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
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

function ReviewExtremeCard({ title, review }: { title: string; review: ReviewExtreme | null }) {
	return (
		<div className="adminAnalyticsListCard">
			<h2 className="adminAnalyticsListTitle">{title}</h2>

			{review ? (
				<div className="adminAnalyticsReviewExtreme">
					<p><strong>Appointment:</strong> #{review.appointmentID}</p>
					<p><strong>Rating:</strong> {review.rating} / 5</p>
					<p><strong>Reason:</strong> {review.reasonKey}</p>
					<p><strong>Date:</strong> {formatDate(review.date)}</p>
					{review.petName ? <p><strong>Pet:</strong> {review.petName}</p> : null}
					{review.customerName ? <p><strong>Customer:</strong> {review.customerName}</p> : null}
					{review.reviewText ? <p><strong>Review:</strong> {review.reviewText}</p> : null}
				</div>
			) : (
				<p className="adminAnalyticsEmptyText">No ratings yet</p>
			)}
		</div>
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

				<div className="adminAnalyticsCard">
					<h2 className="adminAnalyticsMetricLabel">All Time Average Rating</h2>
					<p className="adminAnalyticsMetricValue">{formatRating(analytics.allTimeAverageRating)}</p>
				</div>

				<div className="adminAnalyticsCard">
					<h2 className="adminAnalyticsMetricLabel">Monthly Average Rating</h2>
					<p className="adminAnalyticsMetricValue">{formatRating(analytics.monthlyAverageRating)}</p>
				</div>
			</div>

			<div className="adminAnalyticsListsGrid">
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

				<ReviewExtremeCard title="Highest Scoring Appointment This Month" review={analytics.highestScoringReservationOfMonth} />
				<ReviewExtremeCard title="Lowest Scoring Appointment This Month" review={analytics.lowestScoringReservationOfMonth} />
			</div>
		</div>
	);
}
