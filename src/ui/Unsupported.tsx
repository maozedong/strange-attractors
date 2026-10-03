export function Unsupported({ error }: { error: Error }) {
  return (
    <section className="unsupported" role="alert">
      <h2>This browser can't run the simulation</h2>
      <p>
        The particles are integrated on the graphics card and need WebGL 2 with floating-point
        render targets. A current Chrome, Firefox, Safari or Edge on a laptop or desktop will work.
      </p>
      <p className="label">{error.message}</p>
    </section>
  )
}
