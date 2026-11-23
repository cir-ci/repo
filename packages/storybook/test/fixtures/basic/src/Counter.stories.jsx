import { useState } from 'react'

const Counter = () => {
  const [count, setCount] = useState(0)
  return (
    <button
      type="button"
      id="counter"
      onClick={() => setCount(count + 1)}
      style={{ width: 120 + count * 30, height: 40 }}
    >
      Count {count}
    </button>
  )
}

export default { title: 'Components/Counter', component: Counter }

// The play function clicks after a delay: the screenshot must show "Count 1", which is 30 px wider.
export const Clicked = {
  play: async ({ canvasElement }) => {
    await new Promise((resolve) => setTimeout(resolve, 400))
    canvasElement.querySelector('#counter').click()
    await new Promise((resolve) => setTimeout(resolve, 100))
  },
}
