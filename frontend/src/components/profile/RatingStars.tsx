type RatingStarsProps = {
	value: number;
	onChange?: (value: number) => void;
	readonly?: boolean;
};

export default function RatingStars({
	value,
	onChange,
	readonly = false,
}: RatingStarsProps) {
	return (
		<div className="ratingStars" aria-label={`${value} out of 5 stars`}>
			{[1, 2, 3, 4, 5].map((star) => {
				const filled = star <= value;

				if (readonly) {
					return (
						<span key={star} className={filled ? "starFilled" : "starEmpty"}>
							★
						</span>
					);
				}

				return (
					<button
						key={star}
						type="button"
						className={filled ? "starButton starFilled" : "starButton starEmpty"}
						onClick={() => onChange?.(star)}
						aria-label={`Choose ${star} star rating`}
					>
						★
					</button>
				);
			})}
		</div>
	);
}