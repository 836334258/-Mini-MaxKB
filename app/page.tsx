"use client";
import Image from "next/image";
import Link from "next/link";
import {useRouter} from "next/navigation";

export default function Home() {
  const router = useRouter();
  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex flex-1 w-full max-w-3xl flex-col items-center justify-between py-32 px-16 bg-white dark:bg-black sm:items-start">
        <Link href={'/about'}>about</Link>
        <button onClick={() => router.push('/about')}>about</button>
      </main>
    </div>
  );
}
