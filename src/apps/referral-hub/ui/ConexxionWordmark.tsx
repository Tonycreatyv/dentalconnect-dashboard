type Props = {
  className?: string;
};

export default function ConexxionWordmark({ className = "" }: Props) {
  return <span className={`conexxion-wordmark ${className}`.trim()} aria-label="Conexxion">
    <span aria-hidden="true">Cone<span className="conexxion-wordmark-xx">XX</span>ion</span>
  </span>;
}
