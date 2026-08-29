import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import {
  apiRequest,
  getClientProfile,
  getSubscriptionStatus,
  isVerificationRequiredApiError,
  isUserVerifiedFromSources,
  updateClientProfile,
} from "../Api";
import { resolveSessionImageUrl } from "../../lib/nannySessionProfile";
import { FileSystem } from "../utils/safeFileSystem";
import { Location } from "../utils/safeLocation";
import { rf, rs } from "../utils/responsive";
import { ImagePicker } from "../utils/safeImagePicker";
import { useManageChildStore } from "./manageChildStore";

type Props = {
  navigation?: any;
  onRequireVerification?: () => void;
};

export default function ParentProfileScreen({ navigation, onRequireVerification }: Props) {
  const [name, setName] = useState("Parent User");
  const [email, setEmail] = useState("user@example.com");
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState("");
  const [city, setCity] = useState("");
  const [gender, setGender] = useState("");
  const [about, setAbout] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [imageFile, setImageFile] = useState<any>(null);
  const [imagePreview, setImagePreview] = useState<string>("");
  const [pickingImage, setPickingImage] = useState(false);
  const [locating, setLocating] = useState(false);
  const [genderPickerOpen, setGenderPickerOpen] = useState(false);
  const [verificationStatus, setVerificationStatus] = useState("unverified");
  const [isSubscribed, setIsSubscribed] = useState(false);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [showEditModal, setShowEditModal] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  const { kids, loadChildren } = useManageChildStore(onRequireVerification);
  const goToManageChild = () => navigation?.navigate?.("ManageChild");

  const resolveProfileImage = (value?: string) => {
    return resolveSessionImageUrl(value);
  };

  const pickProfileImageValue = React.useCallback((profile?: Record<string, any> | null) => {
    if (!profile || typeof profile !== "object") return "";
    return String(
      profile.user_image_url ||
      profile.profile_image_url ||
      profile.profile_image ||
      profile.user_image ||
      profile.avatar ||
      profile.user?.user_image_url ||
      profile.user?.profile_image_url ||
      profile.user?.profile_image ||
      profile.user?.user_image ||
      profile.user?.avatar ||
      profile.parent_profile?.user_image_url ||
      profile.parent_profile?.profile_image_url ||
      profile.parent_profile?.profile_image ||
      profile.parent_profile?.user_image ||
      profile.parent_profile?.avatar ||
      profile.image_url ||
      profile.image ||
      ""
    ).trim();
  }, []);

  const applyProfileSnapshot = React.useCallback((snapshot: Record<string, any>) => {
    if (!snapshot || typeof snapshot !== "object") return;

    const fullName = String(
      snapshot.name ||
        snapshot.fullname ||
        [snapshot.first_name || snapshot.firstname, snapshot.last_name || snapshot.lastname]
          .filter(Boolean)
          .join(" ") ||
        ""
    ).trim();
    const nextEmail = String(snapshot.email || "").trim();
    const nextPhone = String(snapshot.phone || snapshot.number || "").trim();
    const nextCountry = String(snapshot.country || "").trim();
    const nextCity = String(
      snapshot.address ||
        snapshot.location ||
        snapshot.city ||
        snapshot.city_area ||
        ""
    ).trim();
    const nextGender = String(snapshot.gender || "").trim();
    const nextAbout = String(snapshot.about_me || snapshot.bio || snapshot.about || "").trim();
    const nextImage = resolveProfileImage(pickProfileImageValue(snapshot));

    if (fullName) {
      setName(fullName);
      const [fn, ...lnParts] = fullName.split(" ");
      setFirstName(fn || "");
      setLastName(lnParts.join(" "));
    }
    if (nextEmail) setEmail(nextEmail);
    if (nextPhone) setPhone(nextPhone);
    if (nextCountry) setCountry(nextCountry);
    if (nextCity) setCity(nextCity);
    if (nextGender) setGender(nextGender);
    if (nextAbout) setAbout(nextAbout);
    if (nextImage) {
      setImageUrl(nextImage);
      setImagePreview((current) => current || nextImage);
    }
  }, [pickProfileImageValue]);

  const syncRemoteProfile = React.useCallback(async () => {
    try {
      const [userId, token] = await Promise.all([
        AsyncStorage.getItem("user_id"),
        AsyncStorage.getItem("token"),
      ]);
      const normalizedUserId = String(userId || "").trim();
      if (!normalizedUserId) return;

      const remote: any = await getClientProfile(normalizedUserId, token || undefined);
      const profile = remote?.profile || remote?.data?.profile || remote?.data || remote;
      if (!profile || typeof profile !== "object") return;

      applyProfileSnapshot(profile);

      const fullName = String(
        profile.name ||
          profile.fullname ||
          [profile.first_name || profile.firstname, profile.last_name || profile.lastname]
            .filter(Boolean)
            .join(" ") ||
          ""
      ).trim();
      const nextEmail = String(profile.email || "").trim();
      const nextPhone = String(profile.phone || profile.number || "").trim();
      const nextCountry = String(profile.country || "").trim();
      const nextAddress = String(profile.address || profile.location || "").trim();
      const nextCity = String(profile.city || profile.city_area || nextAddress).trim();
      const nextGender = String(profile.gender || "").trim();
      const nextAbout = String(profile.about_me || profile.bio || profile.about || "").trim();
      const nextImage = resolveProfileImage(pickProfileImageValue(profile));

      const pairs: [string, string][] = [];
      if (fullName) pairs.push(["user_name", fullName]);
      if (nextEmail) pairs.push(["user_email", nextEmail]);
      if (nextPhone) pairs.push(["user_phone", nextPhone]);
      if (nextCountry) pairs.push(["user_country", nextCountry]);
      if (nextCity) pairs.push(["user_city", nextCity]);
      if (nextAddress) pairs.push(["user_address", nextAddress]);
      if (nextGender) pairs.push(["user_gender", nextGender]);
      if (nextAbout) pairs.push(["user_about", nextAbout]);
      if (nextImage) pairs.push(["user_image", nextImage]);
      if (pairs.length) {
        await AsyncStorage.multiSet(pairs);
      }
    } catch (error: any) {
      const status = Number(error?.status || 0);
      if (status >= 500 || !status) {
        return;
      }
      console.warn("[ParentProfile] remote profile sync failed", error);
    }
  }, [applyProfileSnapshot, pickProfileImageValue]);

  const normalizeStatus = (raw?: string | null) => {
    const status = (raw || "").toLowerCase().trim();
    if (
      status === "verified" ||
      status === "approved" ||
      status.includes("accept")
    ) {
      return "verified";
    }
    if (
      status === "pending" ||
      status === "app-pending" ||
      status === "completed" ||
      status === "quickapp-completed" ||
      status.includes("background_check") ||
      status.includes("background check") ||
      status.includes("admin_approval_pending") ||
      status.includes("admin approval pending") ||
      status.includes("payment_required") ||
      status.includes("payment required") ||
      status.includes("quickapp.created") ||
      status.includes("order.quickapp.completed")
    ) {
      return "pending";
    }
    return "unverified";
  };

  const syncSubscriptionStatus = async () => {
    try {
      const [token, userId] = await Promise.all([
        AsyncStorage.getItem("token"),
        AsyncStorage.getItem("user_id"),
      ]);
      const data = await getSubscriptionStatus(
        token || undefined,
        userId || undefined
      );
      const root = data?.data || data || {};
      const subscribed =
        Boolean(root?.subscribed) ||
        Boolean(root?.is_subscribed) ||
        Boolean(root?.active) ||
        String(root?.status || "").toLowerCase() === "active";
      const plan = String(root?.plan || root?.subscription_plan || "").trim();
      setIsSubscribed(subscribed);
      if (subscribed) {
        await AsyncStorage.setItem("subscription_plan", plan || "Premium Family");
      } else {
        await AsyncStorage.removeItem("subscription_plan");
      }
    } catch {
      // keep fallback from local storage
    }
  };

  const fetchTazStatus = async () => {
    try {
      const [userId, tokenRaw] = await Promise.all([
        AsyncStorage.getItem("user_id"),
        AsyncStorage.getItem("token"),
      ]);
      if (!userId) return;

      let profileStatus = "";
      let profileVerifiedFlag: boolean | null = null;
      let profileVerificationRequired: boolean | null = null;
      try {
        const profileData = await apiRequest<any>("profile-status", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            ...(tokenRaw ? { Authorization: `Bearer ${String(tokenRaw).replace(/"/g, "").trim()}` } : {}),
          },
          body: JSON.stringify({ user_id: String(userId) }),
        }).catch((error) => {
          if (isVerificationRequiredApiError(error)) {
            onRequireVerification?.();
          }
          return null;
        });
        profileVerifiedFlag =
          typeof profileData?.is_verified === "boolean"
            ? profileData.is_verified
            : typeof profileData?.data?.is_verified === "boolean"
            ? profileData.data.is_verified
            : null;
        profileVerificationRequired =
          typeof profileData?.verification_required === "boolean"
            ? profileData.verification_required
            : typeof profileData?.data?.verification_required === "boolean"
            ? profileData.data.verification_required
            : null;
        profileStatus = String(profileData?.status || profileData?.approval_status || "")
          .trim()
          .toLowerCase();
      } catch {
        profileStatus = "";
      }
      const profileIsVerified =
        isUserVerifiedFromSources({
          profileStatus,
          isVerified: profileVerifiedFlag,
          verificationRequired: profileVerificationRequired,
        });
      if (profileIsVerified) {
        setVerificationStatus("verified");
        await AsyncStorage.setItem("user_verification_status", "approved");
        return;
      }

      const data = await apiRequest<any>("taz/status", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ user_id: String(userId) }),
      }).catch((error) => {
        if (isVerificationRequiredApiError(error)) {
          onRequireVerification?.();
        }
        return null;
      });
      if (!data?.success) return;
      const orders = Array.isArray(data?.orders) ? data.orders : [];
      const latestOrder = orders[0] || null;
      const eventStatus = String(
        latestOrder?.normalized_status ||
          latestOrder?.status ||
          data?.status ||
          ""
      )
        .trim()
        .toLowerCase();
      const decisionStatus = String(
        latestOrder?.response_order_status ||
          latestOrder?.decision_status ||
          ""
      )
        .trim()
        .toLowerCase();
      const hasVerified = isUserVerifiedFromSources({
        tazDecisionStatus: decisionStatus,
        tazEventStatus: eventStatus,
        tazStatus: String(data?.status || "").trim().toLowerCase(),
      });
      const hasPending =
        eventStatus.includes("order.quickapp.created") ||
        eventStatus.includes("order.quickapp.completed") ||
        eventStatus.includes("app-pending") ||
        eventStatus === "pending";
      const statusFromApi = String(data?.status || "").trim().toLowerCase();
      const resolvedStatus = String(
        (hasVerified && "verified") ||
          (hasPending && "pending") ||
          (statusFromApi && statusFromApi !== "unknown" ? statusFromApi : "") ||
          (profileStatus && profileStatus !== "unknown" ? profileStatus : "") ||
          ""
      ).trim();
      if (resolvedStatus) {
        setVerificationStatus(normalizeStatus(resolvedStatus));
        await AsyncStorage.setItem("user_verification_status", resolvedStatus);
      }
    } catch (error) {
      if (isVerificationRequiredApiError(error)) {
        onRequireVerification?.();
        return;
      }
      console.error("fetchTazStatus failed", error);
    }
  };

  useEffect(() => {
    const load = async () => {
      const [
        [, fullNameStored],
        [, emailStored],
        [, phoneStored],
        [, countryStored],
        [, cityStored],
        [, addressStored],
        [, genderStored],
        [, aboutStored],
        [, imageStored],
        [, rawStatus],
        [, plan],
      ] = await AsyncStorage.multiGet([
        "user_name",
        "user_email",
        "user_phone",
        "user_country",
        "user_city",
        "user_address",
        "user_gender",
        "user_about",
        "user_image",
        "user_verification_status",
        "subscription_plan",
      ]);

      const fullName = fullNameStored || "Parent User";
      setName(fullName);
      const [fn, ...lnParts] = fullName.split(" ");
      setFirstName(fn || "");
      setLastName(lnParts.join(" "));

      setEmail(emailStored || "user@example.com");
      setPhone(phoneStored || "");
      setCountry(countryStored || "");
      const storedCity = cityStored || addressStored || "";
      setCity(storedCity);
      setGender(genderStored || "");
      setAbout(aboutStored || "");
      const storedImage = resolveProfileImage(imageStored || "");
      setImageUrl(storedImage);
      setImagePreview(storedImage);

      setVerificationStatus(normalizeStatus(rawStatus));

      setIsSubscribed(!!plan);
      await syncSubscriptionStatus();

      await loadChildren();
      await syncRemoteProfile();
    };
    void load();
  }, [loadChildren, syncRemoteProfile]);

  useEffect(() => {
    fetchTazStatus();
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void loadChildren();
        void syncRemoteProfile();
      }
    });

    return () => sub.remove();
  }, [loadChildren, syncRemoteProfile]);

  useEffect(() => {
    const unsubscribe = navigation?.addListener?.("focus", () => {
      void syncRemoteProfile();
    });
    return () => unsubscribe?.();
  }, [navigation, syncRemoteProfile]);

  const statusLabel =
    verificationStatus === "verified"
      ? "Verified"
      : verificationStatus === "pending"
        ? "Pending"
        : "Unverified";

  const openEditModal = () => {
    const parts = (name || "").split(" ");
    setFirstName(parts.shift() || "");
    setLastName(parts.join(" "));
    setShowEditModal(true);
  };

  const pickImageFromLibrary = async () => {
    try {
      setPickingImage(true);
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Permission", "Gallery access is required to pick a photo.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: [ImagePicker.MediaType.Images] as any,
        allowsEditing: true,
        quality: 0.8,
      });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (asset?.uri) {
        setImageFile({
          uri: asset.uri,
          name: asset.fileName || "avatar.jpg",
          type: asset.type || "image/jpeg",
        });
        setImagePreview(asset.uri);
      }
    } finally {
      setPickingImage(false);
    }
  };

  const takePhoto = async () => {
    if (typeof document !== "undefined") {
      // On web, fallback to library picker
      await pickImageFromLibrary();
      return;
    }
    try {
      setPickingImage(true);
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Permission", "Camera access is required to take a photo.");
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        quality: 0.8,
      });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (asset?.uri) {
        setImageFile({
          uri: asset.uri,
          name: asset.fileName || "avatar.jpg",
          type: asset.type || "image/jpeg",
        });
        setImagePreview(asset.uri);
      }
    } finally {
      setPickingImage(false);
    }
  };

  const pickImage = async () => {
    Alert.alert("Profile photo", "Choose an option", [
      { text: "Take Photo", onPress: takePhoto },
      { text: "Choose from Library", onPress: pickImageFromLibrary },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const useCurrentLocation = async () => {
    if (locating || savingProfile) return;
    try {
      setLocating(true);
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Location", "Location access was not granted.");
        return;
      }

      let current: any;
      try {
        current = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });
      } catch {
        current = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
      }

      const latitude = Number(current?.coords?.latitude);
      const longitude = Number(current?.coords?.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        throw new Error("Invalid location coordinates");
      }

      const reverse = await Location.reverseGeocodeAsync({ latitude, longitude }).catch(() => []);
      const best = Array.isArray(reverse) && reverse.length > 0 ? reverse[0] : null;
      const streetLine = [best?.streetNumber, best?.street, best?.name].filter(Boolean).join(" ").trim();
      const cityLine = String(best?.city || best?.subregion || best?.region || "").trim();
      const countryLine = String(best?.country || best?.isoCountryCode || "").trim();
      const formattedAddress = [streetLine, cityLine, countryLine].filter(Boolean).join(", ");
      const coordsLabel = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;

      setCity(formattedAddress || cityLine || coordsLabel);
      if (countryLine) setCountry(countryLine);
      if (!formattedAddress) {
        Alert.alert("Location", "Could not read full address. Coordinates added instead.");
      }
    } catch {
      Alert.alert("Location", "Unable to fetch current location right now.");
    } finally {
      setLocating(false);
    }
  };

  const saveProfile = async () => {
    if (!firstName.trim() || !lastName.trim()) {
      Alert.alert("Missing info", "Please enter first and last name.");
      return;
    }

    try {
      setSavingProfile(true);
      const token = await AsyncStorage.getItem("token");
      const userId =
        (await AsyncStorage.getItem("user_id")) ||
        (await AsyncStorage.getItem("id"));
      if (!userId) {
        Alert.alert("Missing info", "User ID not found. Please re-login.");
        return;
      }
      const payload: Record<string, any> = {
        user_id: userId,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        phone: phone.trim(),
        country: country.trim(),
        city: city.trim(),
        address: city.trim(),
        gender: gender.trim(),
        about_me: about.trim(),
      };

      if (imageFile?.uri) {
        try {
          const base64 = await FileSystem.readAsStringAsync(imageFile.uri, {
            encoding: "base64" as any,
          });
          const mimeRaw = String(imageFile.type || "").trim().toLowerCase();
          const mime = mimeRaw.startsWith("image/") ? mimeRaw : "image/jpeg";
          payload.user_image_base64 = `data:${mime};base64,${base64}`;
          delete payload.user_image;
        } catch (error) {
          console.warn("[ParentProfile] image base64 failed, keeping old image", error);
        }
      } else if (typeof imageFile === "string" && imageFile.trim()) {
        payload.user_image = imageFile.trim();
      }

      const result: any = await updateClientProfile(payload, token || undefined);

      const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();
      setName(fullName || "Parent User");
      setPhone(phone.trim());
      setCountry(country.trim());
      setCity(city.trim());
      setGender(gender.trim());
      setAbout(about.trim());

      const serverImage = resolveProfileImage(
        result?.profile?.user_image_url ||
        result?.profile?.profile_image_url ||
        result?.profile?.profile_image ||
        result?.profile?.user_image ||
        result?.user_image_url ||
        result?.profile_image_url ||
        result?.profile_image ||
        result?.user_image ||
        imagePreview ||
        imageUrl
      );
      setImageUrl(serverImage || "");
      setImagePreview(serverImage || "");
      setImageFile(null);

      await AsyncStorage.multiSet([
        ["user_name", fullName],
        ["user_phone", phone.trim()],
        ["user_country", country.trim()],
        ["user_city", city.trim()],
        ["user_address", city.trim()],
        ["user_gender", gender.trim()],
        ["user_about", about.trim()],
        ["user_image", serverImage || ""],
      ]);

      Alert.alert("Saved", "Profile updated successfully.");
      setShowEditModal(false);
      setGenderPickerOpen(false);
    } catch (err: any) {
      if (isVerificationRequiredApiError(err)) {
        onRequireVerification?.();
        return;
      }
      console.error("saveProfile failed", err);
      Alert.alert("Error", err?.message || "Could not update profile.");
    } finally {
      setSavingProfile(false);
    }
  };

  return (
    <View style={styles.screen}>
      {/* HEADER */}
      <LinearGradient
        colors={["#FF80AB", "#FFB6C1"]}
        style={styles.header}
      >
        <View style={styles.headerTopRow}>
          <TouchableOpacity
            accessibilityLabel="Go back"
            onPress={() => navigation.goBack()}
          >
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.editBtn}
            accessibilityLabel="Edit Profile"
            onPress={openEditModal}
          >
            <Ionicons name="create-outline" size={18} color="#fff" />
            <Text style={styles.editBtnText}>Edit Profile</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.avatar}>
          {imagePreview || imageUrl ? (
            <Image
              source={{ uri: imagePreview || imageUrl }}
              style={{ width: rs(90), height: rs(90), borderRadius: rs(45) }}
            />
          ) : (
            <Ionicons name="person" size={44} color="#FF80AB" />
          )}
          {isSubscribed && (
            <View style={styles.subscriptionIcon}>
              <Ionicons name="star" size={14} color="#fff" />
            </View>
          )}
        </View>

        <Text style={styles.name}>{name}</Text>
        <Text style={styles.email}>{email}</Text>
        <View style={styles.badgeRow}>
          <View
            style={[
              styles.statusBadge,
              verificationStatus === "verified" && styles.statusVerified,
              verificationStatus === "pending" && styles.statusPending,
            ]}
          >
            <Text style={styles.statusText}>{statusLabel}</Text>
          </View>
          {isSubscribed && (
            <View style={styles.subscriptionBadge}>
              <Ionicons name="sparkles" size={12} color="#fff" />
              <Text style={styles.subscriptionText}>Premium</Text>
            </View>
          )}
        </View>
      </LinearGradient>

      {/* CONTENT */}
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* PERSONAL INFO */}
        <Card title="Personal Information">
          <InfoRow icon="call" label="Phone" value={phone || "Not provided"} />
          <InfoRow icon="earth" label="Country" value={country || "Not provided"} />
          <InfoRow icon="location" label="City / Address" value={city || "Not provided"} />
          <InfoRow icon="male-female" label="Gender" value={gender || "Not provided"} />
          <InfoRow icon="person" label="About Me" value={about || "Not provided"} />
        </Card>

        {/* CHILDREN */}
        <Card
          title="Children"
          action={
            <TouchableOpacity
              onPress={goToManageChild}
            >
              <Text style={styles.editText}>Edit</Text>
            </TouchableOpacity>
          }
        >
          {kids && kids.length > 0 ? (
            kids.map((kid: any, index: number) => (
              <TouchableOpacity
                key={String(kid.id ?? `${kid.name || "kid"}-${index}`)}
                style={styles.childRow}
                activeOpacity={0.85}
                onPress={goToManageChild}
              >
                <View style={styles.childAvatar}>
                  <Text style={styles.childLetter}>
                    {(kid.name || "K")[0].toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.childName}>{kid.name || "Child"}</Text>
                  <Text style={styles.childMeta}>
                    {kid.gender || "N/A"} -{" "}
                    {kid.age ? `${kid.age} yrs` : "Age N/A"}
                  </Text>
                  {!!kid.allergies && (
                    <Text style={styles.childExtra}>Allergies: {kid.allergies}</Text>
                  )}
                  {!!kid.medicalConditions && (
                    <Text style={styles.childExtra}>
                      Medical: {kid.medicalConditions}
                    </Text>
                  )}
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={18}
                  color="#C2185B"
                />
              </TouchableOpacity>
            ))
          ) : (
            <TouchableOpacity activeOpacity={0.85} onPress={goToManageChild}>
              <Text style={styles.empty}>No children added yet</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={goToManageChild}
          >
            <Ionicons name="add" size={18} color="#fff" />
            <Text style={styles.primaryBtnText}>Add / Update Children</Text>
          </TouchableOpacity>
        </Card>
      </ScrollView>

      {/* EDIT MODAL */}
      <Modal
        visible={showEditModal}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setShowEditModal(false);
          setGenderPickerOpen(false);
        }}
      >
        <KeyboardAvoidingView
          style={styles.modalKeyboardWrap}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={Platform.OS === "ios" ? rs(24) : 0}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Edit Profile</Text>
              <ScrollView
                style={styles.modalScroll}
                contentContainerStyle={styles.modalScrollContent}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
              >
                <Text style={styles.fieldLabel}>First Name</Text>
                <TextInput
                  style={styles.modalInput}
                  value={firstName}
                  onChangeText={setFirstName}
                  placeholder="Enter first name"
                  autoCapitalize="words"
                />

              <Text style={styles.fieldLabel}>Last Name</Text>
              <TextInput
                style={styles.modalInput}
                value={lastName}
                onChangeText={setLastName}
                placeholder="Enter last name"
                autoCapitalize="words"
              />

              <Text style={styles.fieldLabel}>Number</Text>
              <TextInput
                style={styles.modalInput}
                value={phone}
                onChangeText={setPhone}
                placeholder="Enter phone number"
                keyboardType="phone-pad"
              />

              <Text style={styles.fieldLabel}>Country</Text>
              <TextInput
                style={styles.modalInput}
                value={country}
                onChangeText={setCountry}
                placeholder="Enter country"
              />

              <Text style={styles.fieldLabel}>City / Address</Text>
              <TextInput
                style={styles.modalInput}
                value={city}
                onChangeText={setCity}
                placeholder="Enter city or address"
              />
              <TouchableOpacity
                style={[styles.locateBtn, (locating || savingProfile) && { opacity: 0.7 }]}
                onPress={useCurrentLocation}
                disabled={locating || savingProfile}
              >
                {locating ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="locate-outline" size={16} color="#fff" />
                )}
                <Text style={styles.locateBtnText}>{locating ? "Locating..." : "Locate me"}</Text>
              </TouchableOpacity>

              <Text style={styles.fieldLabel}>Gender</Text>
              <TouchableOpacity
                style={styles.modalInput}
                onPress={() => setGenderPickerOpen((p) => !p)}
              >
                <View style={styles.dropdownValueRow}>
                  <Text style={{ color: gender ? "#000" : "#888" }}>
                    {gender || "Select gender"}
                  </Text>
                  <Ionicons
                    name={genderPickerOpen ? "chevron-up" : "chevron-down"}
                    size={16}
                    color="#AD1457"
                  />
                </View>
              </TouchableOpacity>
              {genderPickerOpen && (
                <View style={styles.dropdown}>
                  {["Male", "Female", "Other", "Prefer not to say"].map((option) => (
                    <TouchableOpacity
                      key={option}
                      style={styles.dropdownItem}
                      onPress={() => {
                        setGender(option);
                        setGenderPickerOpen(false);
                      }}
                    >
                      <Text style={styles.dropdownItemText}>{option}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <Text style={styles.fieldLabel}>About me</Text>
              <TextInput
                style={[styles.modalInput, styles.aboutInput]}
                value={about}
                onChangeText={setAbout}
                placeholder="Write about yourself"
                multiline
                textAlignVertical="top"
              />

                <TouchableOpacity
                style={styles.uploadBtn}
                accessibilityLabel="Upload Your Image"
                onPress={pickImage}
                disabled={pickingImage}
                >
                  {pickingImage ? (
                    <ActivityIndicator size="small" color="#FF80AB" />
                  ) : (
                    <Ionicons name="cloud-upload-outline" size={18} color="#FF80AB" />
                  )}
                  <Text style={styles.uploadText}>
                    {pickingImage ? "Preparing image..." : "Upload Your Image"}
                  </Text>
                </TouchableOpacity>
              </ScrollView>

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => {
                    setShowEditModal(false);
                    setGenderPickerOpen(false);
                  }}
                  disabled={savingProfile}
                >
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.saveBtn, savingProfile && { opacity: 0.7 }]}
                  onPress={saveProfile}
                  disabled={savingProfile}
                >
                  <Text style={styles.saveBtnText}>
                    {savingProfile ? "Saving..." : "Save"}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

/* ---------------- COMPONENTS ---------------- */

function Card({
  title,
  children,
  action,
}: {
  title: string;
  children: any;
  action?: any;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>{title}</Text>
        {action}
      </View>
      {children}
    </View>
  );
}

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: any;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon} size={18} color="#FF80AB" />
      <View style={{ marginLeft: rs(10) }}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={styles.infoValue}>{value}</Text>
      </View>
    </View>
  );
}

/* ---------------- STYLES ---------------- */

const styles = StyleSheet.create({
  header: {
    paddingTop: rs(18),
    paddingBottom: rs(32),
    alignItems: "center",
    borderBottomLeftRadius: rs(24),
    borderBottomRightRadius: rs(24),
  },
  headerTopRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: rs(16),
  },
  avatar: {
    width: rs(90),
    height: rs(90),
    borderRadius: rs(45),
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    marginTop: rs(12),
    marginBottom: rs(10),
    elevation: 4,
  },
  subscriptionIcon: {
    position: "absolute",
    right: rs(-2),
    bottom: rs(-2),
    backgroundColor: "#FFB300",
    borderRadius: rs(12),
    width: rs(22),
    height: rs(22),
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#fff",
  },
  name: {
    fontSize: rf(20),
    fontWeight: "700",
    color: "#fff",
  },
  email: {
    fontSize: rf(13),
    color: "rgba(255,255,255,0.9)",
    marginTop: rs(4),
  },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: rs(8),
    marginTop: rs(8),
  },
  statusBadge: {
    paddingHorizontal: rs(10),
    paddingVertical: rs(4),
    borderRadius: rs(12),
    backgroundColor: "#F3E5F5",
  },
  statusVerified: {
    backgroundColor: "#C8E6C9",
  },
  statusPending: {
    backgroundColor: "#FFE0B2",
  },
  statusText: {
    color: "#6A1B9A",
    fontSize: rf(12),
    fontWeight: "700",
  },
  subscriptionBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FF80AB",
    paddingHorizontal: rs(10),
    paddingVertical: rs(4),
    borderRadius: rs(12),
    gap: rs(6),
  },
  subscriptionText: {
    color: "#fff",
    fontSize: rf(12),
    fontWeight: "700",
  },
  editBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.16)",
    paddingHorizontal: rs(12),
    paddingVertical: rs(8),
    borderRadius: rs(20),
  },
  editBtnText: {
    color: "#fff",
    marginLeft: rs(6),
    fontWeight: "700",
  },
  content: {
    padding: rs(16),
    paddingBottom: rs(40),
  },
  screen: {
    flex: 1,
    backgroundColor: "#FFF7F1",
  },
  card: {
    backgroundColor: "#FFEFE2",
    borderRadius: rs(18),
    padding: rs(16),
    marginBottom: rs(16),
    elevation: 3,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: rs(12),
  },
  cardTitle: {
    fontSize: rf(16),
    fontWeight: "700",
    color: "#880E4F",
  },
  editText: {
    color: "#FF80AB",
    fontWeight: "700",
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: rs(14),
  },
  infoLabel: {
    fontSize: rf(12),
    color: "#AD1457",
  },
  infoValue: {
    fontSize: rf(14),
    fontWeight: "600",
    color: "#880E4F",
  },
  childRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF3F6",
    borderRadius: rs(12),
    padding: rs(10),
    marginBottom: rs(8),
  },
  childAvatar: {
    width: rs(36),
    height: rs(36),
    borderRadius: rs(18),
    backgroundColor: "#FF80AB",
    alignItems: "center",
    justifyContent: "center",
    marginRight: rs(10),
  },
  childLetter: {
    color: "#fff",
    fontWeight: "700",
  },
  childName: {
    fontSize: rf(14),
    fontWeight: "700",
    color: "#880E4F",
  },
  childMeta: {
    fontSize: rf(12),
    color: "#AD1457",
  },
  childExtra: {
    fontSize: rf(11),
    color: "#9B3F67",
    marginTop: rs(2),
  },
  empty: {
    fontSize: rf(12),
    color: "#AD1457",
    marginBottom: rs(12),
  },
  primaryBtn: {
    marginTop: rs(12),
    backgroundColor: "#FF80AB",
    borderRadius: rs(14),
    paddingVertical: rs(14),
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: rs(6),
  },
  primaryBtnText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: rf(14),
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "center",
    alignItems: "center",
    padding: rs(16),
  },
  modalKeyboardWrap: {
    flex: 1,
  },
  modalCard: {
    width: "100%",
    maxWidth: rs(420),
    maxHeight: "88%",
    backgroundColor: "#fff",
    borderRadius: rs(16),
    padding: rs(16),
    elevation: 6,
  },
  modalScroll: {
    maxHeight: rs(420),
  },
  modalScrollContent: {
    paddingBottom: rs(10),
  },
  modalTitle: {
    fontSize: rf(18),
    fontWeight: "700",
    color: "#880E4F",
    marginBottom: rs(6),
  },
  fieldLabel: {
    fontSize: rf(12),
    color: "#AD1457",
    marginTop: rs(10),
    marginBottom: rs(4),
  },
  modalInput: {
    borderWidth: 1,
    borderColor: "#FF80AB50",
    borderRadius: rs(10),
    padding: rs(10),
  },
  aboutInput: {
    height: rs(80),
  },
  locateBtn: {
    marginTop: rs(8),
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: rs(6),
    backgroundColor: "#FF80AB",
    borderRadius: rs(10),
    paddingHorizontal: rs(12),
    paddingVertical: rs(8),
  },
  locateBtnText: {
    color: "#fff",
    fontWeight: "700",
  },
  dropdownValueRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    marginTop: rs(12),
    gap: rs(10),
  },
  cancelBtn: {
    paddingHorizontal: rs(14),
    paddingVertical: rs(10),
    borderRadius: rs(10),
    backgroundColor: "#F3F3F3",
  },
  cancelText: {
    color: "#555",
    fontWeight: "600",
  },
  saveBtn: {
    paddingHorizontal: rs(16),
    paddingVertical: rs(12),
    borderRadius: rs(10),
    backgroundColor: "#FF80AB",
  },
  saveBtnText: {
    color: "#fff",
    fontWeight: "700",
  },
  uploadBtn: {
    marginTop: rs(8),
    flexDirection: "row",
    alignItems: "center",
    gap: rs(6),
    paddingVertical: rs(8),
  },
  uploadText: {
    color: "#FF80AB",
    fontWeight: "700",
  },
  dropdown: {
    borderWidth: 1,
    borderColor: "#FF80AB50",
    borderRadius: rs(10),
    marginTop: rs(6),
    overflow: "hidden",
  },
  dropdownItem: {
    paddingVertical: rs(10),
    paddingHorizontal: rs(12),
    backgroundColor: "#fff",
  },
  dropdownItemText: {
    color: "#880E4F",
    fontWeight: "600",
  },
});
