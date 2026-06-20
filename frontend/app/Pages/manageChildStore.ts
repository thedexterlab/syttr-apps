import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useState } from "react";
import { addKid, deleteKid, getUserKids, updateKid } from "../Api";

export type Kid = {
  id?: string;
  name?: string;
  age?: string | number;
  gender?: string;
  allergies?: string;
  dietaryRestrictions?: string;
  medicalConditions?: string;
  anythingElse?: string;
  
};

const STORAGE_KEY = "manage_children";

const extractKidsArray = (payload: any): any[] => {
  const candidates = [
    payload,
    payload?.kids,
    payload?.data,
    payload?.data?.kids,
    payload?.data?.data,
    payload?.items,
    payload?.results,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }

  return [];
};

const normalizeKid = (row: any): Kid => ({
  id:
    row?.id ??
    row?.kid_id ??
    row?.parent_kid_id ??
    row?.child_id ??
    undefined,
  name: String(row?.name ?? row?.child_name ?? "").trim(),
  age: row?.age ?? row?.child_age ?? "",
  gender: String(row?.gender ?? "").trim(),
  allergies: String(row?.allergies ?? "").trim(),
  medicalConditions: String(
    row?.medical_conditions ?? row?.medicalConditions ?? ""
  ).trim(),
  anythingElse: String(row?.notes ?? row?.anything_else ?? "").trim(),
});

export function useManageChildStore() {
  const [kids, setKids] = useState<Kid[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const persist = async (next: Kid[]) => {
    setKids(next);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };

  const loadChildren = useCallback(async () => {
    setIsLoading(true);
    try {
      try {
        const token = await AsyncStorage.getItem("token");
        const userId =
          (await AsyncStorage.getItem("user_id")) ||
          (await AsyncStorage.getItem("id"));
        console.log("[Kids] load start", { userId });

        if (userId) {
          const remote = await getUserKids(userId, token || undefined);
          const kidsData = extractKidsArray(remote);
          const list: Kid[] = kidsData.map(normalizeKid);
          await persist(list);
          console.log("[Kids] loaded from API", list.length);
          return;
        }
      } catch (e) {
        console.log("[Kids] load error", e);
      }

      // fallback to cache
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        const cached = raw ? JSON.parse(raw) : [];
        const list = Array.isArray(cached) ? cached.map(normalizeKid) : [];
        setKids(list);
        console.log("[Kids] loaded from cache", list.length);
      } catch {
        setKids([]);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadChildren();
  }, [loadChildren]);

  const addChild = async (kid: Kid) => {
    try {
      setIsAdding(true);
      const token = await AsyncStorage.getItem("token");
      const userId =
        (await AsyncStorage.getItem("user_id")) ||
        (await AsyncStorage.getItem("id"));
      console.log("[Kids] add", { kid, userId });
      if (!userId) {
        console.log("[Kids] add aborted: missing user_id");
        return false;
      }
      const payload: any = { user_id: String(userId) };
      if (kid.name) payload.name = kid.name;
      const ageNum =
        kid.age !== undefined && kid.age !== null && kid.age !== ""
          ? Number.parseInt(String(kid.age), 10)
          : undefined;
      if (!Number.isNaN(ageNum as any) && ageNum !== undefined) payload.age = ageNum;
      if (kid.gender) payload.gender = kid.gender;
      if (kid.allergies) payload.allergies = kid.allergies;
      if (kid.medicalConditions) payload.medical_conditions = kid.medicalConditions;
      if (kid.anythingElse) payload.notes = kid.anythingElse;

      await addKid(payload, token || undefined);
      await loadChildren();
      return true;
    } catch (e) {
      console.log("[Kids] add error", e);
      return false;
    } finally {
      setIsAdding(false);
    }
  };

  const editChild = async (index: number, kid: Kid) => {
    try {
      setIsEditing(true);
      console.log("[Kids] edit", { index, kid });
      const token = await AsyncStorage.getItem("token");
      const fallbackKidId =
        index != null && index >= 0 && index < kids.length
          ? kids[index]?.id
          : undefined;
      const kidId = kid.id || fallbackKidId;
      if (!kidId) {
        console.log("[Kids] edit aborted: missing kidId", { kidId: kid.id, fallbackKidId });
        return false;
      }
      const payload: any = {};
      if (kid.name !== undefined) payload.name = String(kid.name).trim();
      const ageNum =
        kid.age !== undefined && kid.age !== null && String(kid.age).trim() !== ""
          ? Number.parseInt(String(kid.age), 10)
          : undefined;
      if (ageNum !== undefined && Number.isFinite(ageNum)) payload.age = ageNum;
      if (kid.gender !== undefined) payload.gender = kid.gender;
      if (kid.allergies !== undefined) payload.allergies = kid.allergies;
      if (kid.medicalConditions !== undefined)
        payload.medical_conditions = kid.medicalConditions;
      if (kid.anythingElse !== undefined) payload.notes = kid.anythingElse;

      await updateKid(
        payload,
        kidId,
        token || undefined
      );
      await loadChildren();
      return true;
    } catch (e) {
      console.log("[Kids] edit error", e);
      return false;
    } finally {
      setIsEditing(false);
    }
  };

  const removeChild = async (index: number, kid?: Kid) => {
    try {
      setIsDeleting(true);
      const token = await AsyncStorage.getItem("token");
      const fallbackKidId =
        index != null && index >= 0 && index < kids.length
          ? kids[index]?.id
          : undefined;
      const kidId = kid?.id || fallbackKidId;

      if (!kidId) {
        const next = kids.filter((_, idx) => idx !== index);
        await persist(next);
        return true;
      }

      await deleteKid(kidId, token || undefined);
      await loadChildren();
      return true;
    } catch (e) {
      console.log("[Kids] delete error", e);
      return false;
    } finally {
      setIsDeleting(false);
    }
  };

  return {
    kids,
    isLoading,
    loadChildren,
    addChild,
    editChild,
    removeChild,
    isAdding,
    isEditing,
    isDeleting,
  };
}


export default function RouteShim() {
  return null as any;
}

