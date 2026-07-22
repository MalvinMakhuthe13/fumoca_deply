import { supabase } from './supabaseClient.js';

export async function signUp(email, password) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password
  });

  if (error) return alert(error.message);
  alert("Signup successful");
}

export async function login(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  if (error) return alert(error.message);

  window.location.href = "index.html";
}