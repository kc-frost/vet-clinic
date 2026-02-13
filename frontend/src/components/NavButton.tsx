import { useNavigate } from "react-router-dom";

type NavButtonProps = {
  to: string;
  className?: string;
  children: React.ReactNode;
};

export default function NavButton({ to, className = "", children }: NavButtonProps) {
  const navigate = useNavigate();

  function handleClick() {
    navigate(to);
  }

  return (
    <button type="button" className={className} onClick={handleClick}>
      {children}
    </button>
  );
}
