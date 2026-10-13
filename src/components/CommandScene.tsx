import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls, RoundedBox, Text } from '@react-three/drei'
import { useEffect, useRef, type ComponentType } from 'react'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { zones, type ZoneId } from '../lib/modules'

const positions: Record<ZoneId, [number, number, number]> = {
  prospects: [-4.4, 0, -2.2], activities: [0, 0, -2.2], offers: [4.4, 0, -2.2],
  payments: [-4.4, 0, 2.2], production: [0, 0, 2.2], delivery: [4.4, 0, 2.2],
}
const blue = '#3977df'
const ink = '#233f69'
const pale = '#dce9fb'
const white = '#ffffff'
const green = '#5cbd9d'

function Building({ color = blue }: { color?: string }) {
  return <group>
    <RoundedBox args={[1.25, 1.2, .84]} position={[0, .8, 0]} radius={.1}><meshStandardMaterial color={white} /></RoundedBox>
    <mesh position={[0, 1.46, 0]}><boxGeometry args={[1.45, .14, 1.04]} /><meshStandardMaterial color={color} /></mesh>
    <mesh position={[-.29, .87, .43]}><boxGeometry args={[.35, .42, .03]} /><meshStandardMaterial color={pale} /></mesh>
    <mesh position={[.3, .87, .43]}><boxGeometry args={[.35, .42, .03]} /><meshStandardMaterial color={pale} /></mesh>
    <mesh position={[0, .43, .44]}><boxGeometry args={[.28, .45, .035]} /><meshStandardMaterial color={color} /></mesh>
  </group>
}
function Meeting() {
  return <group>
    <mesh position={[0, .62, 0]}><cylinderGeometry args={[.72, .72, .13, 8]} /><meshStandardMaterial color={white} /></mesh>
    {[-1, 0, 1].map((index) => <group key={index} position={[Math.sin(index * 2.1) * 1.05, 0, Math.cos(index * 2.1) * 1.05]}>
      <mesh position={[0, .55, 0]}><boxGeometry args={[.38, .09, .38]} /><meshStandardMaterial color={blue} /></mesh>
      <mesh position={[0, .26, 0]}><cylinderGeometry args={[.06, .06, .5, 6]} /><meshStandardMaterial color={ink} /></mesh>
    </group>)}
    <mesh position={[0, .98, 0]}><boxGeometry args={[.56, .07, .36]} /><meshStandardMaterial color={pale} /></mesh>
  </group>
}
function Offers() {
  return <group>
    <RoundedBox args={[1.25, 1.35, .16]} position={[-.33, .93, -.07]} rotation={[0, -.15, 0]} radius={.08}><meshStandardMaterial color={white} /></RoundedBox>
    <RoundedBox args={[1.25, 1.35, .16]} position={[.23, .81, .22]} rotation={[0, .12, 0]} radius={.08}><meshStandardMaterial color={pale} /></RoundedBox>
    {[.77, .98, 1.19].map((y, index) => <mesh key={y} position={[.16, y, .33]}><boxGeometry args={[index === 0 ? .43 : .7, .045, .015]} /><meshStandardMaterial color={index === 0 ? blue : '#8eaddb'} /></mesh>)}
    <mesh position={[.18, .49, .34]}><boxGeometry args={[.36, .1, .02]} /><meshStandardMaterial color={green} /></mesh>
  </group>
}
function Payments() {
  return <group>
    <RoundedBox args={[1.65, .94, .88]} position={[0, .65, 0]} radius={.14}><meshStandardMaterial color={white} /></RoundedBox>
    <mesh position={[0, .76, .46]}><boxGeometry args={[1.24, .1, .02]} /><meshStandardMaterial color={blue} /></mesh>
    <mesh position={[-.42, .53, .46]}><boxGeometry args={[.28, .15, .02]} /><meshStandardMaterial color={green} /></mesh>
    <mesh position={[.54, 1.32, -.3]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[.25, .25, .07, 12]} /><meshStandardMaterial color={'#f6ca69'} /></mesh>
  </group>
}
function Production() {
  return <group>
    <mesh position={[0, .45, 0]}><boxGeometry args={[1.9, .13, 1.18]} /><meshStandardMaterial color={white} /></mesh>
    {[-.47, .47].map(x => <group key={x} position={[x, 0, 0]}>
      <mesh position={[0, .96, -.08]}><boxGeometry args={[.67, .72, .08]} /><meshStandardMaterial color={ink} /></mesh>
      <mesh position={[0, .97, -.026]}><boxGeometry args={[.57, .6, .016]} /><meshStandardMaterial color={x < 0 ? '#8fc0ff' : '#a8e4d0'} /></mesh>
      <mesh position={[0, .52, -.05]}><boxGeometry args={[.09, .14, .09]} /><meshStandardMaterial color={blue} /></mesh>
      <mesh position={[0, .58, .43]}><boxGeometry args={[.66, .04, .2]} /><meshStandardMaterial color={pale} /></mesh>
    </group>)}
  </group>
}
function Delivery() {
  return <group>
    <Building color={green} />
    <mesh position={[.8, .74, .36]}><boxGeometry args={[.52, .68, .06]} /><meshStandardMaterial color={white} /></mesh>
    <mesh position={[.8, .85, .4]}><boxGeometry args={[.32, .06, .01]} /><meshStandardMaterial color={green} /></mesh>
    <mesh position={[.8, .67, .4]}><boxGeometry args={[.32, .06, .01]} /><meshStandardMaterial color={pale} /></mesh>
  </group>
}
const objects: Record<ZoneId, ComponentType> = {
  prospects: Building, activities: Meeting, offers: Offers, payments: Payments, production: Production, delivery: Delivery,
}

function Zone({ id, selected, onSelect }: { id: ZoneId; selected: boolean; onSelect: (id: ZoneId) => void }) {
  const zone = zones.find(item => item.id === id)!
  const Object = objects[id]
  return <group position={positions[id]} onClick={(event) => { event.stopPropagation(); onSelect(id) }}
    onPointerOver={(event) => { event.stopPropagation(); document.body.style.cursor = 'pointer' }}
    onPointerOut={() => { document.body.style.cursor = '' }}>
    <RoundedBox args={[3.62, .25, 3.48]} position={[0, .02, 0]} radius={.16}>
      <meshStandardMaterial color={selected ? '#bed7ff' : '#eaf1fb'} />
    </RoundedBox>
    <mesh position={[0, .18, 0]}><boxGeometry args={[3.39, .04, 3.24]} /><meshStandardMaterial color={selected ? '#dceaff' : '#f8fbff'} /></mesh>
    <Object />
    <Text fontSize={.23} color={ink} anchorX="center" position={[0, .32, 1.25]} rotation={[-Math.PI / 2, 0, 0]}>{zone.label}</Text>
    <mesh position={[-1.3, .27, -1.22]}><cylinderGeometry args={[.21, .21, .05, 16]} /><meshStandardMaterial color={selected ? blue : '#aac5ed'} /></mesh>
    <Text fontSize={.16} color={white} position={[-1.3, .31, -1.22]} rotation={[-Math.PI / 2, 0, 0]}>{zone.number}</Text>
  </group>
}

function CameraControls({ selected, resetSignal }: { selected: ZoneId | null; resetSignal: number }) {
  const controls = useRef<OrbitControlsImpl>(null)
  const { camera, invalidate } = useThree()
  useEffect(() => {
    const target = selected ? new THREE.Vector3(...positions[selected]) : new THREE.Vector3(0, 0, 0)
    const startTarget = controls.current?.target.clone() ?? new THREE.Vector3()
    const startPosition = camera.position.clone()
    const desiredPosition = target.clone().add(new THREE.Vector3(11, 10, 11))
    let frame = 0
    let raf = 0
    const animate = () => {
      frame += 1
      const t = Math.min(frame / 28, 1)
      const eased = 1 - Math.pow(1 - t, 3)
      controls.current?.target.copy(startTarget).lerp(target, eased)
      camera.position.copy(startPosition).lerp(desiredPosition, eased)
      controls.current?.update()
      invalidate()
      if (t < 1) raf = requestAnimationFrame(animate)
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      controls.current?.target.copy(target)
      camera.position.copy(desiredPosition)
      controls.current?.update()
      invalidate()
    } else raf = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(raf)
  }, [selected, resetSignal, camera, invalidate])
  return <OrbitControls ref={controls} enableDamping={false} minZoom={45} maxZoom={92} minPolarAngle={.65} maxPolarAngle={1.22} minAzimuthAngle={-.9} maxAzimuthAngle={.9} enablePan panSpeed={.6} />
}

export default function CommandScene({ selected, onSelect, resetSignal }: { selected: ZoneId | null; onSelect: (id: ZoneId) => void; resetSignal: number }) {
  useEffect(() => () => { document.body.style.cursor = '' }, [])
  return <Canvas frameloop="demand" orthographic camera={{ position: [11, 10, 11], zoom: 55, near: .1, far: 100 }} dpr={[1, 1.5]} gl={{ antialias: true, powerPreference: 'high-performance' }}>
    <color attach="background" args={['#e7f1ff']} />
    <ambientLight intensity={2} />
    <directionalLight position={[5, 10, 7]} intensity={2.4} />
    <mesh position={[0, -.3, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[15, 11]} /><meshStandardMaterial color={'#d8e7fb'} /></mesh>
    <mesh position={[0, -.265, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[13.5, .13]} /><meshStandardMaterial color={'#bdd3f4'} /></mesh>
    <mesh position={[-2.2, -.264, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[.13, 8]} /><meshStandardMaterial color={'#bdd3f4'} /></mesh>
    <mesh position={[2.2, -.264, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[.13, 8]} /><meshStandardMaterial color={'#bdd3f4'} /></mesh>
    {zones.map(zone => <Zone key={zone.id} id={zone.id} selected={selected === zone.id} onSelect={onSelect} />)}
    <CameraControls selected={selected} resetSignal={resetSignal} />
  </Canvas>
}
