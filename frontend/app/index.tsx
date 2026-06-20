import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, AppState, Easing, LogBox, Platform, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { checkNannyApprovalStatus, isUserRejectedFromSources, isUserVerifiedFromSources } from './_Api';
import { consumeStoredNotificationResponse } from '../lib/pushNotifications';

import AvailabilityScreen from './Pages/AvailabilityScreen';
import CreateClientProfileScreen from './Pages/CreateClientProfileScreen';
import CreateKidsScreen from './Pages/CreateKidsScreen';
import CreateNannyProfileScreen from './Pages/CreateNannyProfileScreen';
import GetVerifiedScreen from './Pages/GetVerifiedScreen';
import InterviewPendingScreen from './Pages/InterviewPendingScreen';
import InterviewScheduleScreen from './Pages/InterviewScheduleScreen';
import JobStatusScreen from './Pages/JobStatusScreen';
import LoginScreen from './Pages/LoginScreen';
import ManageChildScreen from './Pages/ManageChildScreen';
import NannyHomeScreen from './Pages/NannyHomeScreen';
import NannyJobsScreen from './Pages/NannyJobsScreen';
import NannyListScreen from './Pages/NannyListScreen';
import NannySettingsScreen from './Pages/NannySettingsScreen';
import ParentJobRequestsScreen from './Pages/ParentJobRequestsScreen';
import ParentsHomeScreen from './Pages/ParentsHomeScreen';
import ParentProfileScreen from './Pages/ParentProfileScreen';
import ParentSupportTicketsScreen from './Pages/ParentSupportTicketsScreen';
import ParentTransactionHistoryScreen from './Pages/ParentTransactionHistoryScreen';
import VerificationUnderReviewScreen from './Pages/VerificationUnderReviewScreen';
import ClientMessagesScreen from './Pages/ClientMessagesScreen';
import NannyMessagesScreen from './Pages/NannyMessagesScreen';
import NannyCalendarScreen from './Pages/NannyCalendarScreen';
import NannyNotificationsScreen from './Pages/NannyNotificationsScreen';
import CalendarScreen from './Pages/CalendarScreen';
import NotificationsScreen from './Pages/NotificationsScreen';
import FavoriteNanniesScreen from './Pages/FavoriteNanniesScreen';
import ForgotPasswordScreen from './Pages/ForgotPasswordScreen';
import SettingsScreen from './Pages/SettingScreen';
import SignUpClientScreen from './Pages/SignUpClientScreen';
import SignupNannyScreen, { type SignupData as NannySignupData } from './Pages/SignupNannyScreen';
import SubscriptionScreen from './Pages/SubscriptionScreen';
import AboutUsScreen from './Static/AboutUsScreen';
import ContactUsScreen from './Static/ContactUsScreen';
import FaqScreen from './Static/FaqScreen';
import InviteFriendsScreen from './Static/InviteFriendsScreen';
import NannyFaqScreen from './Static/NannyFaqScreen';
import ParentBlacklistScreen from './Static/ParentBlacklistScreen';
import PrivacyPolicyScreen from './Static/PrivacyPolicyScreen';
import RateAppScreen from './Static/RateAppScreen';
import SplashScreen from './Static/SplashScreen';
import TermsConditionsScreen from './Static/TermsConditionsScreen';
import WelcomeScreen from './Static/WelcomeScreen';
import AddPaymentMethodScreen from '../lib/AddPaymentMethodScreen';
import ClientBookingDetailScreen from './components/ClientBookingDetailScreen';
import ClientChatScreen from './components/ClientChatScreen';
import NannyChatScreen from './components/NannyChatScreen';
import NotificationDetailScreen from './components/NotificationDetailScreen';
import ParentJobRequestDetailScreen from './Pages/ParentJobRequestDetailScreen';
import NannyFavoriteJobsScreen from './components/NannyFavoriteJobsScreen';
import NannyBookingDetailScreen from './components/NannyBookingDetailScreen';
import NannyJobDetailScreen from './components/NannyJobDetailScreen';
import NannyProfileScreen from './components/NannyProfileScreen';
import NannyProfileViewScreen from './components/NannyProfileViewScreen';
import ParentProfileViewScreen from './components/ParentProfileViewScreen';
import NannyWithdrawScreen from './components/NannyWithdrawScreen';
import PostJobScreen from './components/PostJobScreen';

export default function Index() {
  type VerificationOrigin = 'kids' | 'availability' | 'home' | 'loginPending' | 'nannyVerification';
  type AvailabilityOrigin = 'profile' | 'home' | 'settings';
  type JobStatusOrigin = 'parentHome' | 'parentSettings';
  type ManageChildrenOrigin = 'parentSettings' | 'parentProfile' | 'postJob';
  type PaymentMethodsOrigin =
    | 'parentSettings'
    | 'nannySettings'
    | 'getVerified'
    | 'postJob'
    | 'parentNannyProfile'
    | 'subscription';
  type NannyWithdrawOrigin = 'nannyHome' | 'nannySettings';
  type ForgotPasswordBackTarget = 'login' | 'parentSettings' | 'nannySettings';
  type ClientBookingOrigin = 'parentJobRequestDetail' | 'parentCalendar' | 'jobStatus' | 'parentNotifications';
  type NannyJobOrigin = 'nannyJobs' | 'nannyFavoriteJobs' | 'nannyHome';
  type NannyProfileOrigin =
    | 'parentJobRequestDetail'
    | 'nannySettings'
    | 'clientBookingDetail'
    | 'clientChat'
    | 'parentHome'
    | 'parentMessages'
    | 'parentNannyList'
    | 'favoriteNannies';
  type NannyBookingOrigin = 'nannyCalendar' | 'nannyHome';
  type NannyChatOrigin = 'nannyMessages' | 'nannyBookingDetail';
  type NannyParentProfileOrigin = 'nannyJobDetail' | 'nannyBookingDetail';
  type ScreenName =
    | 'splash'
    | 'welcome'
    | 'parentHome'
    | 'parentSettings'
    | 'parentAboutUs'
    | 'parentContactUs'
    | 'parentSupportTickets'
    | 'parentFaq'
    | 'parentInviteFriends'
    | 'parentRateApp'
    | 'parentTerms'
    | 'parentPrivacy'
    | 'parentJobRequests'
    | 'parentJobRequestDetail'
    | 'clientBookingDetail'
    | 'parentManageChildren'
    | 'parentProfile'
    | 'parentNannyList'
    | 'parentNannyProfile'
    | 'favoriteNannies'
    | 'paymentMethods'
    | 'parentTransactionHistory'
    | 'subscription'
    | 'postJob'
    | 'jobStatus'
    | 'parentBlacklist'
    | 'parentCalendar'
    | 'parentNotifications'
    | 'parentNotificationDetail'
    | 'parentMessages'
    | 'clientChat'
    | 'nannyHome'
    | 'nannyJobs'
    | 'nannyJobDetail'
    | 'nannySettings'
    | 'nannyWithdraw'
    | 'nannyProfileView'
    | 'nannyParentProfile'
    | 'nannyFavoriteJobs'
    | 'nannyCalendar'
    | 'nannyBookingDetail'
    | 'nannyNotifications'
    | 'nannyNotificationDetail'
    | 'nannyMessages'
    | 'nannyChat'
    | 'nannyAboutUs'
    | 'nannyContactUs'
    | 'nannyFaq'
    | 'nannyInviteFriends'
    | 'nannyRateApp'
    | 'nannyTerms'
    | 'nannyPrivacy'
    | 'signupNanny'
    | 'signupClient'
    | 'createClientProfile'
    | 'createKids'
    | 'createNannyProfile'
    | 'availability'
    | 'getVerified'
    | 'interviewSchedule'
    | 'interviewPending'
    | 'verificationUnderReview'
    | 'signupClientTerms'
    | 'signupClientPrivacy'
    | 'signupNannyTerms'
    | 'signupNannyPrivacy'
    | 'forgotPassword'
    | 'login';
  type StaticScreenName =
    | 'parentAboutUs'
    | 'parentContactUs'
    | 'parentFaq'
    | 'parentInviteFriends'
    | 'parentRateApp'
    | 'parentTerms'
    | 'parentPrivacy'
    | 'nannyAboutUs'
    | 'nannyContactUs'
    | 'nannyFaq'
    | 'nannyInviteFriends'
    | 'nannyRateApp'
    | 'nannyTerms'
    | 'nannyPrivacy'
    | 'signupClientTerms'
    | 'signupClientPrivacy'
    | 'signupNannyTerms'
    | 'signupNannyPrivacy';
  const [screen, setScreen] = useState<ScreenName>('splash');
  const [verificationOrigin, setVerificationOrigin] = useState<VerificationOrigin>('kids');
  const [availabilityOrigin, setAvailabilityOrigin] = useState<AvailabilityOrigin>('profile');
  const [jobStatusOrigin, setJobStatusOrigin] = useState<JobStatusOrigin>('parentHome');
  const [manageChildrenOrigin, setManageChildrenOrigin] =
    useState<ManageChildrenOrigin>('parentSettings');
  const [paymentMethodsOrigin, setPaymentMethodsOrigin] =
    useState<PaymentMethodsOrigin>('parentSettings');
  const [nannyWithdrawOrigin, setNannyWithdrawOrigin] =
    useState<NannyWithdrawOrigin>('nannySettings');
  const [forgotPasswordBackTarget, setForgotPasswordBackTarget] =
    useState<ForgotPasswordBackTarget>('login');
  const [selectedParentJobRequest, setSelectedParentJobRequest] = useState<any | null>(null);
  const [selectedParentNannyProfile, setSelectedParentNannyProfile] = useState<any | null>(null);
  const [selectedClientBooking, setSelectedClientBooking] = useState<any | null>(null);
  const [selectedClientBookingDate, setSelectedClientBookingDate] = useState<string | undefined>(undefined);
  const [clientBookingOrigin, setClientBookingOrigin] =
    useState<ClientBookingOrigin>('parentJobRequestDetail');
  const [selectedParentChatParams, setSelectedParentChatParams] = useState<any | null>(null);
  const [selectedNannyChatParams, setSelectedNannyChatParams] = useState<any | null>(null);
  const [selectedNotificationDetail, setSelectedNotificationDetail] = useState<any | null>(null);
  const [selectedNannyJob, setSelectedNannyJob] = useState<any | null>(null);
  const [selectedNannyBooking, setSelectedNannyBooking] = useState<any | null>(null);
  const [selectedNannyParentProfile, setSelectedNannyParentProfile] = useState<any | null>(null);
  const [selectedNannyBookingDate, setSelectedNannyBookingDate] =
    useState<string | undefined>(undefined);
  const [nannyBookingOrigin, setNannyBookingOrigin] = useState<NannyBookingOrigin>('nannyCalendar');
  const [nannyJobOrigin, setNannyJobOrigin] = useState<NannyJobOrigin>('nannyJobs');
  const [nannyChatOrigin, setNannyChatOrigin] = useState<NannyChatOrigin>('nannyMessages');
  const [nannyParentProfileOrigin, setNannyParentProfileOrigin] =
    useState<NannyParentProfileOrigin>('nannyJobDetail');
  const [nannyProfileOrigin, setNannyProfileOrigin] = useState<NannyProfileOrigin>('nannySettings');
  const [parentSupportTicketsBackTarget, setParentSupportTicketsBackTarget] =
    useState<ScreenName>('parentSettings');
  const [staticBackTargets, setStaticBackTargets] = useState<
    Partial<Record<StaticScreenName, ScreenName>>
  >({});
  const [pendingNannySignup, setPendingNannySignup] = useState<NannySignupData | null>(null);

  const transitionProgress = useRef(new Animated.Value(1)).current;
  const prevScreenRef = useRef<ScreenName>('splash');
  const directionRef = useRef(1);

  const screenOrder = useMemo<ScreenName[]>(
    () => [
      'splash',
      'welcome',
      'login',
      'parentHome',
      'parentSettings',
      'parentAboutUs',
      'parentContactUs',
      'parentSupportTickets',
      'parentFaq',
      'parentInviteFriends',
      'parentRateApp',
      'parentTerms',
      'parentPrivacy',
      'parentJobRequests',
      'parentJobRequestDetail',
      'clientBookingDetail',
      'parentManageChildren',
      'parentProfile',
      'parentNannyList',
      'parentNannyProfile',
      'favoriteNannies',
      'paymentMethods',
      'parentTransactionHistory',
      'subscription',
      'postJob',
      'jobStatus',
      'parentBlacklist',
      'parentCalendar',
      'parentNotifications',
      'parentNotificationDetail',
      'parentMessages',
      'clientChat',
      'nannyHome',
      'nannyJobs',
      'nannyJobDetail',
      'nannySettings',
      'nannyWithdraw',
      'nannyProfileView',
      'nannyParentProfile',
      'nannyFavoriteJobs',
      'nannyCalendar',
      'nannyBookingDetail',
      'nannyNotifications',
      'nannyNotificationDetail',
      'nannyMessages',
      'nannyChat',
      'nannyAboutUs',
      'nannyContactUs',
      'nannyFaq',
      'nannyInviteFriends',
      'nannyRateApp',
      'nannyTerms',
      'nannyPrivacy',
      'signupNanny',
      'signupClient',
      'signupClientTerms',
      'signupClientPrivacy',
      'signupNannyTerms',
      'signupNannyPrivacy',
      'forgotPassword',
      'createClientProfile',
      'createKids',
      'createNannyProfile',
      'availability',
      'getVerified',
      'interviewSchedule',
      'interviewPending',
      'verificationUnderReview',
    ],
    []
  );
  const screenIndex = useMemo(
    () =>
      screenOrder.reduce<Record<ScreenName, number>>((acc, item, idx) => {
        acc[item] = idx;
        return acc;
      }, {} as Record<ScreenName, number>),
    [screenOrder]
  );

  const routeFromNotificationResponse = useCallback(async () => {
    const stored = await consumeStoredNotificationResponse();
    const payload = stored?.notification || {};
    const inApp = payload?.in_app || {};
    const data = inApp?.data || payload?.data || payload;
    const type = String(payload?.type || data?.type || "").trim().toLowerCase();
    const conversationId =
      data?.conversation_id ||
      payload?.conversation_id ||
      data?.in_app?.data?.conversation_id;
    const jobId =
      data?.job_id ||
      data?.job?.id ||
      payload?.job_id ||
      payload?.job?.id;
    const applicationId =
      data?.application_id ||
      data?.job_application_id ||
      data?.application?.id ||
      payload?.application_id;
    const userType = String((await AsyncStorage.getItem('user_type')) || '').trim().toLowerCase();
    const isNanny = userType === 'nanny' || userType === 'syttr';

    if (type === 'chat_message' || type === 'chat') {
      if (isNanny) {
        setSelectedNannyChatParams({
          conversationId,
          userId: data?.user_id,
          nannyId: data?.nanny_id,
        });
        setNannyChatOrigin('nannyMessages');
        setScreen('nannyChat');
      } else {
        setSelectedParentChatParams({
          conversationId,
          userId: data?.user_id,
          nannyId: data?.nanny_id,
        });
        setScreen('clientChat');
      }
      return;
    }

    if (isNanny) {
      if (type === 'hire_request' || type === 'extra_hours_request') {
        setSelectedNotificationDetail({
          ...inApp,
          ...data,
          type,
          job_id: jobId,
          application_id: applicationId,
          raw: payload,
        });
        setScreen('nannyNotificationDetail');
        return;
      }
      if (jobId || applicationId) {
        setSelectedNannyBooking({
          ...data,
          id: String(jobId || applicationId),
          job_id: jobId,
          application_id: applicationId,
          raw: data,
          status: data?.status || data?.application_status || type,
        });
        setSelectedNannyBookingDate(undefined);
        setScreen('nannyBookingDetail');
        return;
      }
    } else if (jobId || applicationId) {
      setClientBookingOrigin('parentNotifications');
      setSelectedClientBooking({
        ...data,
        id: String(jobId || applicationId),
        job_id: jobId,
        application_id: applicationId,
        raw: data,
        status: data?.status || data?.application_status || type,
      });
      setSelectedClientBookingDate(undefined);
      setScreen('clientBookingDetail');
    }
  }, []);

  useEffect(() => {
    void routeFromNotificationResponse();
  }, [routeFromNotificationResponse]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void routeFromNotificationResponse();
      }
    });

    return () => sub.remove();
  }, [routeFromNotificationResponse]);

  useEffect(() => {
    if (__DEV__ && Platform.OS === 'web') {
      LogBox.ignoreLogs([
        '"shadow*" style props are deprecated. Use "boxShadow".',
        'props.pointerEvents is deprecated. Use style.pointerEvents',
        'Cannot pipe to a closed or destroyed stream',
      ]);
    }
  }, []);

  useEffect(() => {
    const previous = prevScreenRef.current;
    directionRef.current = (screenIndex[screen] ?? 0) >= (screenIndex[previous] ?? 0) ? 1 : -1;
    prevScreenRef.current = screen;

    transitionProgress.setValue(0);
    Animated.timing(transitionProgress, {
      toValue: 1,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [screen, screenIndex, transitionProgress]);

  const transitionStyle = {
    flex: 1,
    opacity: transitionProgress,
    transform: [
      {
        translateX: transitionProgress.interpolate({
          inputRange: [0, 1],
          outputRange: [24 * directionRef.current, 0],
        }),
      },
      {
        scale: transitionProgress.interpolate({
          inputRange: [0, 1],
          outputRange: [0.99, 1],
        }),
      },
    ],
  };
  const staticScreenFallback = useMemo<Record<StaticScreenName, ScreenName>>(
    () => ({
      parentAboutUs: 'parentSettings',
      parentContactUs: 'parentSettings',
      parentFaq: 'parentSettings',
      parentInviteFriends: 'parentSettings',
      parentRateApp: 'parentSettings',
      parentTerms: 'parentSettings',
      parentPrivacy: 'parentSettings',
      nannyAboutUs: 'nannySettings',
      nannyContactUs: 'nannySettings',
      nannyFaq: 'nannySettings',
      nannyInviteFriends: 'nannySettings',
      nannyRateApp: 'nannySettings',
      nannyTerms: 'nannySettings',
      nannyPrivacy: 'nannySettings',
      signupClientTerms: 'signupClient',
      signupClientPrivacy: 'signupClient',
      signupNannyTerms: 'signupNanny',
      signupNannyPrivacy: 'signupNanny',
    }),
    []
  );

  const screensNeedingGlobalSafeArea = useMemo<Set<ScreenName>>(
    () =>
      new Set<ScreenName>([
        'splash',
        'parentSettings',
        'parentAboutUs',
        'parentContactUs',
        'parentFaq',
        'parentInviteFriends',
        'parentRateApp',
        'parentJobRequests',
        'parentJobRequestDetail',
        'clientBookingDetail',
        'parentManageChildren',
        'parentProfile',
        'parentNannyList',
        'parentNannyProfile',
        'favoriteNannies',
        'paymentMethods',
        'subscription',
        'postJob',
        'parentBlacklist',
        'parentCalendar',
        'parentNotifications',
        'parentNotificationDetail',
        'parentMessages',
        'clientChat',
        'nannyJobs',
        'nannyJobDetail',
        'nannySettings',
        'nannyWithdraw',
        'nannyFavoriteJobs',
        'nannyCalendar',
        'nannyBookingDetail',
        'nannyNotifications',
        'nannyNotificationDetail',
        'nannyMessages',
        'nannyChat',
        'nannyAboutUs',
        'nannyContactUs',
        'nannyFaq',
        'nannyInviteFriends',
        'nannyRateApp',
        'forgotPassword',
      ]),
    []
  );
  const nannyRestrictedScreens = useMemo<Set<ScreenName>>(
    () =>
      new Set<ScreenName>([
        'nannyHome',
        'nannyJobs',
        'nannyJobDetail',
        'nannySettings',
        'nannyWithdraw',
        'nannyProfileView',
        'nannyFavoriteJobs',
        'nannyCalendar',
        'nannyBookingDetail',
        'nannyNotifications',
        'nannyNotificationDetail',
        'nannyMessages',
        'nannyChat',
        'nannyAboutUs',
        'nannyContactUs',
        'nannyFaq',
        'nannyInviteFriends',
        'nannyRateApp',
        'nannyTerms',
        'nannyPrivacy',
        'availability',
      ]),
    []
  );
  const nannyVerificationFlowScreens = useMemo<Set<ScreenName>>(
    () =>
      new Set<ScreenName>([
        'splash',
        'welcome',
        'login',
        'forgotPassword',
        'signupNanny',
        'signupNannyTerms',
        'signupNannyPrivacy',
        'createNannyProfile',
        'availability',
        'getVerified',
        'interviewSchedule',
        'interviewPending',
      ]),
    []
  );
  const normalizeNannyGateState = (
    statusRaw?: string | null,
    interviewStatusRaw?: string | null,
    options?: { verificationRequired?: boolean | null; isVerified?: boolean | null }
  ) => {
    const status = String(statusRaw || '').toLowerCase().trim();
    const interviewStatus = String(interviewStatusRaw || '').toLowerCase().trim();
    const verificationRequired = options?.verificationRequired;
    const isVerified = options?.isVerified;
    const isInterviewWaiting = ['scheduled', 'pending', 'requested', 'rescheduled'].includes(
      interviewStatus
    );

    if (
      isUserVerifiedFromSources({
        adminStatus: status,
        isVerified,
        verificationRequired,
      })
    ) {
      return 'verified' as const;
    }
    if (isUserRejectedFromSources({ adminStatus: status })) {
      return 'rejected' as const;
    }
    if (status === 'pending') {
      return isInterviewWaiting ? ('interviewPending' as const) : ('verificationRequired' as const);
    }
    if (
      status === 'pending_verification' ||
      status === 'pending verification' ||
      interviewStatus === 'approved' ||
      interviewStatus === 'completed'
    ) {
      return 'verificationRequired' as const;
    }
    return 'interviewPending' as const;
  };

  useEffect(() => {
    let isActive = true;

    const enforceNannyStatus = async () => {
      const shouldPoll =
        nannyRestrictedScreens.has(screen) ||
        nannyVerificationFlowScreens.has(screen) ||
        screen === 'getVerified';
      if (!shouldPoll) return;

      const [[, storedStatus], [, storedInterviewStatus], [, nannyId], [, token], [, apiKey], [, userType]] =
        await AsyncStorage.multiGet([
        'nanny_approval_state',
        'nanny_interview_status',
        'nanny_id',
        'token',
        'api_key',
        'user_type',
      ]);

      const normalizedUserType = String(userType || '').toLowerCase().trim();
      if (!['nanny', 'syttr'].includes(normalizedUserType) && !String(nannyId || '').trim()) {
        return;
      }

      const normalizedStoredStatus = String(storedStatus || '').toLowerCase().trim();
      if (normalizedStoredStatus.includes('reject') || normalizedStoredStatus.includes('blacklist')) {
        if (isActive && screen !== 'interviewPending') {
          setScreen('interviewPending');
        }
        return;
      }

      const normalizedNannyId = String(nannyId || '').trim();
      if (!normalizedNannyId) return;

      try {
        const res: any = await checkNannyApprovalStatus(
          { nanny_id: normalizedNannyId },
          token || undefined,
          apiKey || undefined
        );
        if (!isActive) return;

        const status = String(
          res?.status ||
            res?.data?.status ||
            res?.approval_status ||
            res?.data?.approval_status ||
            ''
        )
          .toLowerCase()
          .trim();
        const interviewStatus = String(
          res?.interview?.status ||
            res?.data?.interview?.status ||
            res?.interview_status ||
            res?.data?.interview_status ||
            ''
        )
          .toLowerCase()
          .trim();
        const verificationRequired =
          typeof res?.verification_required === 'boolean'
            ? res.verification_required
            : typeof res?.data?.verification_required === 'boolean'
            ? res.data.verification_required
            : null;
        const isVerified =
          typeof res?.is_verified === 'boolean'
            ? res.is_verified
            : typeof res?.data?.is_verified === 'boolean'
            ? res.data.is_verified
            : null;
        const gateState = normalizeNannyGateState(status, interviewStatus, {
          verificationRequired,
          isVerified,
        });
        const verifiedByAnySource = isUserVerifiedFromSources({
          adminStatus: status,
          isVerified,
          verificationRequired,
        });

        if (status || interviewStatus) {
          const updates: [string, string][] = [];
          const persistedStatus = verifiedByAnySource ? 'approved' : status;
          if (persistedStatus) {
            updates.push([
              'nanny_approval_state',
              persistedStatus,
            ], ['user_verification_status', persistedStatus]);
          }
          if (interviewStatus) {
            updates.push(['nanny_interview_status', interviewStatus]);
          }
          if (updates.length) {
            await AsyncStorage.multiSet(updates);
          }
        }

        if (gateState === 'rejected') {
          if (isActive && screen !== 'interviewPending') {
            setScreen('interviewPending');
          }
          return;
        }

        if (gateState === 'verificationRequired') {
          if (isActive && screen !== 'getVerified' && screen !== 'interviewPending') {
            setVerificationOrigin('nannyVerification');
            setScreen('getVerified');
          }
          return;
        }

        if (gateState === 'interviewPending' && nannyRestrictedScreens.has(screen)) {
          if (isActive && screen !== 'interviewPending') {
            setScreen('interviewPending');
          }
        }
      } catch {
        // Ignore polling failures and keep current UI state.
      }
    };

    void enforceNannyStatus();
    const intervalId = setInterval(() => {
      void enforceNannyStatus();
    }, 5000);

    return () => {
      isActive = false;
      clearInterval(intervalId);
    };
  }, [nannyRestrictedScreens, nannyVerificationFlowScreens, screen]);

  useEffect(() => {
    let active = true;

    const enforceLocalVerificationGate = async () => {
      const [[, userType], [, storedStatus], [, storedInterviewStatus], [, nannyId]] = await AsyncStorage.multiGet([
        'user_type',
        'nanny_approval_state',
        'nanny_interview_status',
        'nanny_id',
      ]);
      if (!active) return;

      const normalizedUserType = String(userType || '').toLowerCase().trim();
      const isNannyUser = ['nanny', 'syttr'].includes(normalizedUserType) || !!String(nannyId || '').trim();
      if (!isNannyUser) return;

      const gateState = normalizeNannyGateState(storedStatus, storedInterviewStatus);
      if (
        gateState === 'verificationRequired' &&
        !nannyVerificationFlowScreens.has(screen) &&
        screen !== 'interviewPending'
      ) {
        setVerificationOrigin('nannyVerification');
        setScreen('getVerified');
        return;
      }
      if (gateState === 'rejected' && screen !== 'interviewPending') {
        setScreen('interviewPending');
      }
    };

    void enforceLocalVerificationGate();
    return () => {
      active = false;
    };
  }, [nannyVerificationFlowScreens, screen]);

  const openStaticScreen = (target: StaticScreenName, origin: ScreenName = screen) => {
    setStaticBackTargets((prev) => ({ ...prev, [target]: origin }));
    setScreen(target);
  };

  const backFromStaticScreen = (target: StaticScreenName) => {
    const previous = staticBackTargets[target] || staticScreenFallback[target];
    setScreen(previous);
  };

  const handleSplashFinish = async () => {
    try {
      const entries = await AsyncStorage.multiGet([
        'token',
        'user_type',
        'nanny_id',
        'user_id',
        'user_verification_status',
        'nanny_approval_state',
        'nanny_interview_status',
      ]);
      const map = Object.fromEntries(entries);
      const token = String(map.token || '')
        .replace(/^Bearer\s+/i, '')
        .replace(/"/g, '')
        .trim();
      if (!token) {
        setScreen('welcome');
        return;
      }

      const userType = String(map.user_type || '').toLowerCase().trim();
      const approvalState = String(map.nanny_approval_state || '').toLowerCase().trim();
      const hasNannyId = !!String(map.nanny_id || '').trim();
      const isNannyUser =
        userType === 'nanny' ||
        userType === 'syttr' ||
        (!userType && hasNannyId);

      if (isNannyUser) {
        const profileRes: any = hasNannyId
          ? await checkNannyApprovalStatus({ nanny_id: String(map.nanny_id || '') }, token || undefined)
          : null;
        const latestStatus = String(
          profileRes?.status ||
            profileRes?.data?.status ||
            profileRes?.approval_status ||
            profileRes?.data?.approval_status ||
            approvalState
        )
          .toLowerCase()
          .trim();
        const interviewStatus = String(
          profileRes?.interview?.status ||
            profileRes?.data?.interview?.status ||
            profileRes?.interview_status ||
            profileRes?.data?.interview_status ||
            ''
        )
          .toLowerCase()
          .trim();
        const verificationRequired =
          typeof profileRes?.verification_required === 'boolean'
            ? profileRes.verification_required
            : typeof profileRes?.data?.verification_required === 'boolean'
            ? profileRes.data.verification_required
            : null;
        const isVerified =
          typeof profileRes?.is_verified === 'boolean'
            ? profileRes.is_verified
            : typeof profileRes?.data?.is_verified === 'boolean'
            ? profileRes.data.is_verified
            : null;
        const effectiveStatus = isUserVerifiedFromSources({
          adminStatus: latestStatus || approvalState,
          isVerified,
          verificationRequired,
        })
          ? 'approved'
          : latestStatus || approvalState;
        const gateState = normalizeNannyGateState(effectiveStatus, interviewStatus, {
          verificationRequired,
          isVerified,
        });

        if (effectiveStatus || interviewStatus) {
          const updates: [string, string][] = [];
          if (effectiveStatus) {
            updates.push([
              'nanny_approval_state',
              effectiveStatus,
            ], ['user_verification_status', effectiveStatus]);
          }
          if (interviewStatus) {
            updates.push(['nanny_interview_status', interviewStatus]);
          }
          if (updates.length) {
            await AsyncStorage.multiSet(updates);
          }
        }

        if (gateState === 'rejected') {
          setScreen('interviewPending');
          return;
        }
        if (gateState === 'verificationRequired') {
          setVerificationOrigin('nannyVerification');
          setScreen('getVerified');
          return;
        }
        if (gateState === 'interviewPending') {
          setVerificationOrigin('loginPending');
          setScreen('interviewPending');
          return;
        }
        setScreen('nannyHome');
        return;
      }

      const parentStatus = String(map.user_verification_status || '').toLowerCase().trim();
      if (parentStatus === 'blacklisted') {
        setScreen('parentBlacklist');
        return;
      }

      setScreen('parentHome');
    } catch {
      setScreen('welcome');
    }
  };

  let renderedScreen: React.ReactNode;

  if (screen === 'splash') {
    renderedScreen = <SplashScreen onFinish={() => void handleSplashFinish()} />;
  } else if (screen === 'welcome') {
    renderedScreen = (
      <WelcomeScreen
        onSitterPress={() => setScreen('signupNanny')}
        onClientPress={() => setScreen('signupClient')}
        onLoginPress={() => setScreen('login')}
      />
    );
  } else if (screen === 'login') {
    renderedScreen = (
      <LoginScreen
        onBack={() => setScreen('welcome')}
        onSignupClient={() => setScreen('signupClient')}
        onSignupNanny={() => setScreen('signupNanny')}
        onTermsPress={() => openStaticScreen('signupClientTerms', 'login')}
        onPrivacyPress={() => openStaticScreen('signupClientPrivacy', 'login')}
        onForgotPassword={() => {
          setForgotPasswordBackTarget('login');
          setScreen('forgotPassword');
        }}
        onClientSuccess={() => setScreen('parentHome')}
        onClientBlacklisted={() => setScreen('parentBlacklist')}
        onNannySuccess={() => setScreen('nannyHome')}
        onNannyPending={() => {
          setVerificationOrigin('nannyVerification');
          setScreen('getVerified');
        }}
        onNannyRejected={() => setScreen('interviewPending')}
      />
    );
  } else if (screen === 'parentHome') {
    renderedScreen = (
      <ParentsHomeScreen
        onPostJobPress={() => setScreen('postJob')}
        onSettings={() => setScreen('parentSettings')}
        onJobRequests={() => setScreen('parentJobRequests')}
        onChat={() => setScreen('parentMessages')}
        onNotifications={() => setScreen('parentNotifications')}
        onCalendarPress={() => setScreen('parentCalendar')}
        onFindNanny={(nanny) => {
          if (nanny) {
            setNannyProfileOrigin('parentHome');
            setSelectedParentNannyProfile(nanny);
            setScreen('parentNannyProfile');
            return;
          }
          setScreen('parentNannyList');
        }}
        onGetVerified={() => {
          setVerificationOrigin('home');
          setScreen('getVerified');
        }}
        onBlacklisted={() => setScreen('parentBlacklist')}
        onLogout={() => setScreen('login')}
      />
    );
  } else if (screen === 'parentSettings') {
    renderedScreen = (
      <SettingsScreen
        onHome={() => setScreen('parentHome')}
        onSettings={() => setScreen('parentSettings')}
        onBack={() => setScreen('parentHome')}
        onAboutUs={() => openStaticScreen('parentAboutUs')}
        onContactUs={() => openStaticScreen('parentContactUs')}
        onSupportTickets={() => {
          setParentSupportTicketsBackTarget('parentSettings');
          setScreen('parentSupportTickets');
        }}
        onFaq={() => openStaticScreen('parentFaq')}
        onInviteFriends={() => openStaticScreen('parentInviteFriends')}
        onRateApp={() => openStaticScreen('parentRateApp')}
        onTerms={() => openStaticScreen('parentTerms')}
        onPrivacyPolicy={() => openStaticScreen('parentPrivacy')}
        onJobStatus={() => {
          setJobStatusOrigin('parentSettings');
          setScreen('jobStatus');
        }}
        onJobRequests={() => {
          setScreen('parentJobRequests');
        }}
        onMessages={() => setScreen('parentMessages')}
        onNotifications={() => setScreen('parentNotifications')}
        onCalendar={() => setScreen('parentCalendar')}
        onManageChild={() => {
          setManageChildrenOrigin('parentSettings');
          setScreen('parentManageChildren');
        }}
        onParentProfile={() => setScreen('parentProfile')}
        onFavorites={() => setScreen('favoriteNannies')}
        onPaymentMethods={() => {
          setPaymentMethodsOrigin('parentSettings');
          setScreen('paymentMethods');
        }}
        onTransactionHistory={() => setScreen('parentTransactionHistory')}
        onSubscription={() => setScreen('subscription')}
        onChangePassword={() => {
          setForgotPasswordBackTarget('parentSettings');
          setScreen('forgotPassword');
        }}
        onGetVerified={() => {
          setVerificationOrigin('home');
          setScreen('getVerified');
        }}
        onBlacklisted={() => setScreen('parentBlacklist')}
        onLogout={() => setScreen('login')}
      />
    );
  } else if (screen === 'parentAboutUs') {
    renderedScreen = <AboutUsScreen navigation={{ goBack: () => backFromStaticScreen('parentAboutUs') }} />;
  } else if (screen === 'parentContactUs') {
    renderedScreen = (
      <ContactUsScreen
        navigation={{
          goBack: () => backFromStaticScreen('parentContactUs'),
          navigate: (route: string) => {
            if (route === 'supportTickets') {
              setParentSupportTicketsBackTarget('parentContactUs');
              setScreen('parentSupportTickets');
            }
          },
        }}
      />
    );
  } else if (screen === 'parentSupportTickets') {
    renderedScreen = (
      <ParentSupportTicketsScreen
        onBack={() => setScreen(parentSupportTicketsBackTarget)}
        onCreateTicket={() => openStaticScreen('parentContactUs', 'parentSupportTickets')}
      />
    );
  } else if (screen === 'parentFaq') {
    renderedScreen = (
      <FaqScreen
        navigation={{
          goBack: () => backFromStaticScreen('parentFaq'),
          navigate: (route: string) => {
            if (route === 'contactUs') {
              openStaticScreen('parentContactUs', 'parentFaq');
            }
          },
        }}
      />
    );
  } else if (screen === 'parentInviteFriends') {
    renderedScreen = <InviteFriendsScreen navigation={{ goBack: () => backFromStaticScreen('parentInviteFriends') }} />;
  } else if (screen === 'parentRateApp') {
    renderedScreen = <RateAppScreen navigation={{ goBack: () => backFromStaticScreen('parentRateApp') }} />;
  } else if (screen === 'parentTerms') {
    renderedScreen = <TermsConditionsScreen navigation={{ goBack: () => backFromStaticScreen('parentTerms') }} />;
  } else if (screen === 'parentPrivacy') {
    renderedScreen = <PrivacyPolicyScreen navigation={{ goBack: () => backFromStaticScreen('parentPrivacy') }} />;
  } else if (screen === 'parentJobRequests') {
    renderedScreen = (
      <ParentJobRequestsScreen
        onOpenDetail={(item) => {
          setSelectedParentJobRequest(item);
          setScreen('parentJobRequestDetail');
        }}
        onHome={() => setScreen('parentHome')}
        onJobRequests={() => setScreen('parentJobRequests')}
        onMessages={() => setScreen('parentMessages')}
        onNotifications={() => setScreen('parentNotifications')}
        onCalendar={() => setScreen('parentCalendar')}
        onSettings={() => setScreen('parentSettings')}
      />
    );
  } else if (screen === 'parentJobRequestDetail') {
    renderedScreen = (
      <ParentJobRequestDetailScreen
        item={selectedParentJobRequest}
        onBack={() => setScreen('parentJobRequests')}
        onOpenNannyProfile={(nanny) => {
          setNannyProfileOrigin('parentJobRequestDetail');
          setSelectedParentNannyProfile(nanny || null);
          setScreen('parentNannyProfile');
        }}
        onOpenBooking={(item) => {
          setClientBookingOrigin('parentJobRequestDetail');
          setSelectedClientBooking(item || selectedParentJobRequest);
          setSelectedClientBookingDate(undefined);
          setScreen('clientBookingDetail');
        }}
        onHome={() => setScreen('parentHome')}
        onJobRequests={() => setScreen('parentJobRequests')}
        onMessages={() => setScreen('parentMessages')}
        onNotifications={() => setScreen('parentNotifications')}
        onCalendar={() => setScreen('parentCalendar')}
        onSettings={() => setScreen('parentSettings')}
      />
    );
  } else if (screen === 'parentNannyProfile') {
    renderedScreen = (
      <NannyProfileScreen
        route={{
          params: {
            id: selectedParentNannyProfile?.id || selectedParentNannyProfile?.nanny_id,
            name:
              selectedParentNannyProfile?.fullname ||
              selectedParentNannyProfile?.name ||
              undefined,
            nanny: selectedParentNannyProfile || undefined,
          },
        }}
        onRequirePayment={() => {
          setPaymentMethodsOrigin('parentNannyProfile');
          setScreen('paymentMethods');
        }}
        onBack={() =>
          setScreen(
            nannyProfileOrigin === 'parentJobRequestDetail'
              ? 'parentJobRequestDetail'
              : nannyProfileOrigin === 'clientBookingDetail'
              ? 'clientBookingDetail'
              : nannyProfileOrigin === 'clientChat'
              ? 'clientChat'
              : nannyProfileOrigin === 'parentMessages'
              ? 'parentMessages'
              : nannyProfileOrigin === 'parentHome'
              ? 'parentHome'
              : nannyProfileOrigin === 'parentNannyList'
              ? 'parentNannyList'
              : nannyProfileOrigin === 'favoriteNannies'
              ? 'favoriteNannies'
              : 'nannySettings'
          )
        }
        onMessage={(params) => {
          setSelectedParentChatParams({
            conversationId: params?.conversationId,
            nannyId:
              params?.nannyId ||
              selectedParentNannyProfile?.nanny_id ||
              selectedParentNannyProfile?.id,
            userId: params?.userId,
            name:
              params?.name ||
              selectedParentNannyProfile?.fullname ||
              selectedParentNannyProfile?.name,
          });
          setScreen('clientChat');
        }}
      />
    );
  } else if (screen === 'clientBookingDetail') {
    renderedScreen = (
      <ClientBookingDetailScreen
        route={{ params: { event: selectedClientBooking || selectedParentJobRequest, date: selectedClientBookingDate } }}
        onBack={() => setScreen(clientBookingOrigin)}
        onViewSyttrProfile={(params) => {
          setNannyProfileOrigin('clientBookingDetail');
          setSelectedParentNannyProfile({
            id: params?.nannyId,
            nanny_id: params?.nannyId,
            fullname: params?.name,
            name: params?.name,
          });
          setScreen('parentNannyProfile');
        }}
        onMessageSyttr={(params) => {
          setSelectedParentChatParams({
            conversationId: params?.conversationId,
            nannyId: params?.nannyId,
            userId: params?.userId,
            name: params?.name,
          });
          setScreen('clientChat');
        }}
      />
    );
  } else if (screen === 'parentManageChildren') {
    renderedScreen = (
      <ManageChildScreen
        onBack={() =>
          setScreen(
            manageChildrenOrigin === 'postJob'
              ? 'postJob'
              : manageChildrenOrigin === 'parentProfile'
              ? 'parentProfile'
              : 'parentSettings'
          )
        }
      />
    );
  } else if (screen === 'parentProfile') {
    renderedScreen = (
      <ParentProfileScreen
        navigation={{
          goBack: () => setScreen('parentSettings'),
          navigate: (route: string) => {
            if (route === 'ManageChild') {
              setManageChildrenOrigin('parentProfile');
              setScreen('parentManageChildren');
            }
          },
        }}
      />
    );
  } else if (screen === 'parentNannyList') {
    renderedScreen = (
      <NannyListScreen
        onBack={() => setScreen('parentHome')}
        onOpenProfile={(nanny) => {
          setNannyProfileOrigin('parentNannyList');
          setSelectedParentNannyProfile(nanny || null);
          setScreen('parentNannyProfile');
        }}
      />
    );
  } else if (screen === 'favoriteNannies') {
    renderedScreen = (
      <FavoriteNanniesScreen
        onBack={() => setScreen('parentSettings')}
        onOpenProfile={(nanny) => {
          setNannyProfileOrigin('favoriteNannies');
          setSelectedParentNannyProfile(nanny || null);
          setScreen('parentNannyProfile');
        }}
      />
    );
  } else if (screen === 'paymentMethods') {
    renderedScreen = (
      <AddPaymentMethodScreen
        onBack={() => setScreen(paymentMethodsOrigin)}
      />
    );
  } else if (screen === 'parentTransactionHistory') {
    renderedScreen = <ParentTransactionHistoryScreen onBack={() => setScreen('parentSettings')} />;
  } else if (screen === 'subscription') {
    renderedScreen = (
      <SubscriptionScreen
        onBack={() => setScreen('parentSettings')}
        onAddPaymentMethod={() => {
          setPaymentMethodsOrigin('subscription');
          setScreen('paymentMethods');
        }}
      />
    );
  } else if (screen === 'postJob') {
    renderedScreen = (
      <PostJobScreen
        onBack={() => setScreen('parentHome')}
        onRequirePayment={() => {
          setPaymentMethodsOrigin('postJob');
          setScreen('paymentMethods');
        }}
        onAddChild={() => {
          setManageChildrenOrigin('postJob');
          setScreen('parentManageChildren');
        }}
        onSuccess={() => setScreen('parentHome')}
      />
    );
  } else if (screen === 'jobStatus') {
    renderedScreen = (
      <JobStatusScreen
        onBack={() => setScreen(jobStatusOrigin === 'parentSettings' ? 'parentSettings' : 'parentHome')}
        onOpenBooking={(event, date) => {
          setClientBookingOrigin('jobStatus');
          setSelectedClientBooking(event);
          setSelectedClientBookingDate(date);
          setScreen('clientBookingDetail');
        }}
      />
    );
  } else if (screen === 'parentBlacklist') {
    renderedScreen = (
      <ParentBlacklistScreen
        onResolved={() => setScreen('parentHome')}
        onSignOut={() => setScreen('login')}
        onSupport={() => openStaticScreen('parentContactUs', 'parentBlacklist')}
      />
    );
  } else if (screen === 'parentCalendar') {
    renderedScreen = (
      <CalendarScreen
        onOpenBooking={(event, date) => {
          setClientBookingOrigin('parentCalendar');
          setSelectedClientBooking(event);
          setSelectedClientBookingDate(date);
          setScreen('clientBookingDetail');
        }}
        onBack={() => setScreen('parentHome')}
        onHome={() => setScreen('parentHome')}
        onMessages={() => setScreen('parentMessages')}
        onJobRequests={() => setScreen('parentJobRequests')}
        onNotifications={() => setScreen('parentNotifications')}
        onSettings={() => setScreen('parentSettings')}
      />
    );
  } else if (screen === 'parentNotifications') {
    renderedScreen = (
      <NotificationsScreen
        onOpenDetail={(item) => {
          const rawData = item?.raw?.data || item?.raw?.notification?.data || {};
          const jobId =
            item?.job_id ||
            item?.job?.id ||
            item?.job?.job_id ||
            rawData?.job_id ||
            rawData?.job?.id ||
            rawData?.job?.job_id;
          const notificationType = String(item?.type || rawData?.type || '').trim().toLowerCase();
          const notificationText = `${item?.title || ''} ${item?.subtitle || ''} ${item?.message || ''}`.toLowerCase();
          const isCompletionReminder =
            notificationType === 'job_complete_reminder_parent' ||
            (
              notificationType === '' &&
              notificationText.includes('complete job') &&
              notificationText.includes('booking')
            );

          if (isCompletionReminder && jobId) {
            setClientBookingOrigin('parentNotifications');
            setSelectedClientBooking({
              ...rawData,
              ...item,
              id: String(jobId),
              bookingId: String(jobId),
              jobId,
              job_id: jobId,
              application_id: item?.application_id || rawData?.application_id,
              job: item?.job || rawData?.job || { id: jobId, job_id: jobId },
              raw: item?.raw || item,
              status: item?.status || rawData?.status || notificationType,
              type: notificationType || item?.type,
            });
            setSelectedClientBookingDate(undefined);
            setScreen('clientBookingDetail');
            return;
          }

          setSelectedNotificationDetail(item);
          setScreen('parentNotificationDetail');
        }}
        onHome={() => setScreen('parentHome')}
        onMessages={() => setScreen('parentMessages')}
        onJobRequests={() => setScreen('parentJobRequests')}
        onNotifications={() => setScreen('parentNotifications')}
        onCalendar={() => setScreen('parentCalendar')}
        onSettings={() => setScreen('parentSettings')}
      />
    );
  } else if (screen === 'parentNotificationDetail') {
    renderedScreen = (
      <NotificationDetailScreen
        route={{ params: { item: selectedNotificationDetail || undefined } }}
        onBack={() => setScreen('parentNotifications')}
      />
    );
  } else if (screen === 'parentMessages') {
    renderedScreen = (
      <ClientMessagesScreen
        onOpenChat={(params) => {
          setSelectedParentChatParams(params);
          setScreen('clientChat');
        }}
        onHome={() => setScreen('parentHome')}
        onMessages={() => setScreen('parentMessages')}
        onJobRequests={() => setScreen('parentJobRequests')}
        onNotifications={() => setScreen('parentNotifications')}
        onCalendar={() => setScreen('parentCalendar')}
        onSettings={() => setScreen('parentSettings')}
      />
    );
  } else if (screen === 'clientChat') {
    renderedScreen = (
      <ClientChatScreen
        route={{ params: selectedParentChatParams || undefined }}
        onBack={() => setScreen('parentMessages')}
        onCloseChat={() => setScreen('parentMessages')}
        onViewProfile={(params) => {
          setNannyProfileOrigin('clientChat');
          setSelectedParentNannyProfile({
            id: params?.nannyId,
            nanny_id: params?.nannyId,
            fullname: params?.name,
            name: params?.name,
          });
          setScreen('parentNannyProfile');
        }}
      />
    );
  } else if (screen === 'nannyHome') {
    renderedScreen = (
      <NannyHomeScreen
        onAvailability={() => {
          setAvailabilityOrigin('home');
          setScreen('availability');
        }}
        onWithdraw={() => {
          setNannyWithdrawOrigin('nannyHome');
          setScreen('nannyWithdraw');
        }}
        onJobPress={(job) => {
          setSelectedNannyJob(job);
          setNannyJobOrigin('nannyHome');
          setScreen('nannyJobDetail');
        }}
        onOpenBooking={(event, date) => {
          setSelectedNannyBooking(event);
          setSelectedNannyBookingDate(date);
          setNannyBookingOrigin('nannyHome');
          setScreen('nannyBookingDetail');
        }}
        onJobs={() => setScreen('nannyJobs')}
        onMessages={() => setScreen('nannyMessages')}
        onNotifications={() => setScreen('nannyNotifications')}
        onCalendar={() => setScreen('nannyCalendar')}
        onSettings={() => setScreen('nannySettings')}
        onRejected={() => setScreen('interviewPending')}
      />
    );
  } else if (screen === 'nannyJobs') {
    renderedScreen = (
      <NannyJobsScreen
        onRequireVerification={() => {
          setVerificationOrigin('nannyVerification');
          setScreen('getVerified');
        }}
        onJobSelect={(job) => {
          setSelectedNannyJob(job);
          setNannyJobOrigin('nannyJobs');
          setScreen('nannyJobDetail');
        }}
        onHome={() => setScreen('nannyHome')}
        onJobs={() => setScreen('nannyJobs')}
        onCalendar={() => setScreen('nannyCalendar')}
        onMessages={() => setScreen('nannyMessages')}
        onNotifications={() => setScreen('nannyNotifications')}
        onSettings={() => setScreen('nannySettings')}
      />
    );
  } else if (screen === 'nannyJobDetail') {
    renderedScreen = (
      <NannyJobDetailScreen
        job={selectedNannyJob || undefined}
        onRequireVerification={() => {
          setVerificationOrigin('nannyVerification');
          setScreen('getVerified');
        }}
        onOpenParentProfile={(parent) => {
          setSelectedNannyParentProfile(parent);
          setNannyParentProfileOrigin('nannyJobDetail');
          setScreen('nannyParentProfile');
        }}
        onBack={() => setScreen(nannyJobOrigin)}
      />
    );
  } else if (screen === 'nannySettings') {
    renderedScreen = (
      <NannySettingsScreen
        onBack={() => setScreen('nannyHome')}
        onHome={() => setScreen('nannyHome')}
        onJobs={() => setScreen('nannyJobs')}
        onSettings={() => setScreen('nannySettings')}
        onAboutUs={() => openStaticScreen('nannyAboutUs')}
        onFaq={() => openStaticScreen('nannyFaq')}
        onTerms={() => openStaticScreen('nannyTerms')}
        onPrivacy={() => openStaticScreen('nannyPrivacy')}
        onContact={() => openStaticScreen('nannyContactUs')}
        onInviteFriends={() => openStaticScreen('nannyInviteFriends')}
        onRateApp={() => openStaticScreen('nannyRateApp')}
        onAvailability={() => {
          setAvailabilityOrigin('settings');
          setScreen('availability');
        }}
        onFavoriteJobs={() => setScreen('nannyFavoriteJobs')}
        onMessages={() => setScreen('nannyMessages')}
        onNotifications={() => setScreen('nannyNotifications')}
        onCalendar={() => setScreen('nannyCalendar')}
        onWithdraw={() => {
          setNannyWithdrawOrigin('nannySettings');
          setScreen('nannyWithdraw');
        }}
        onProfileView={() => setScreen('nannyProfileView')}
        onChangePassword={() => {
          setForgotPasswordBackTarget('nannySettings');
          setScreen('forgotPassword');
        }}
        onLogout={() => setScreen('login')}
      />
    );
  } else if (screen === 'nannyWithdraw') {
    renderedScreen = <NannyWithdrawScreen onBack={() => setScreen(nannyWithdrawOrigin)} />;
  } else if (screen === 'nannyProfileView') {
    renderedScreen = <NannyProfileViewScreen onBack={() => setScreen('nannySettings')} />;
  } else if (screen === 'nannyParentProfile') {
    renderedScreen = (
      <ParentProfileViewScreen
        parent={selectedNannyParentProfile || undefined}
        onBack={() => setScreen(nannyParentProfileOrigin)}
      />
    );
  } else if (screen === 'nannyFavoriteJobs') {
    renderedScreen = (
      <NannyFavoriteJobsScreen
        onBack={() => setScreen('nannySettings')}
        onHome={() => setScreen('nannyHome')}
        onJobs={() => setScreen('nannyJobs')}
        onCalendar={() => setScreen('nannyCalendar')}
        onMessages={() => setScreen('nannyMessages')}
        onNotifications={() => setScreen('nannyNotifications')}
        onSettings={() => setScreen('nannySettings')}
        onOpenJob={(job) => {
          setSelectedNannyJob(job);
          setNannyJobOrigin('nannyFavoriteJobs');
          setScreen('nannyJobDetail');
        }}
      />
    );
  } else if (screen === 'nannyCalendar') {
    renderedScreen = (
      <NannyCalendarScreen
        onOpenBooking={(event, date) => {
          setSelectedNannyBooking(event);
          setSelectedNannyBookingDate(date);
          setNannyBookingOrigin('nannyCalendar');
          setScreen('nannyBookingDetail');
        }}
        onHome={() => setScreen('nannyHome')}
        onMessages={() => setScreen('nannyMessages')}
        onJobs={() => setScreen('nannyJobs')}
        onNotifications={() => setScreen('nannyNotifications')}
        onSettings={() => setScreen('nannySettings')}
      />
    );
  } else if (screen === 'nannyBookingDetail') {
    renderedScreen = (
      <NannyBookingDetailScreen
        route={{
          params: {
            event: selectedNannyBooking || undefined,
            date: selectedNannyBookingDate,
            viewer: 'nanny',
          },
        }}
        onBack={() => setScreen(nannyBookingOrigin)}
        onOpenParentProfile={(parent) => {
          setSelectedNannyParentProfile(parent);
          setNannyParentProfileOrigin('nannyBookingDetail');
          setScreen('nannyParentProfile');
        }}
        onMessage={(params) => {
          setSelectedNannyChatParams(params);
          setNannyChatOrigin('nannyBookingDetail');
          setScreen('nannyChat');
        }}
      />
    );
  } else if (screen === 'nannyNotifications') {
    renderedScreen = (
      <NannyNotificationsScreen
        onOpenDetail={(item) => {
          setSelectedNotificationDetail(item);
          setScreen('nannyNotificationDetail');
        }}
        onHome={() => setScreen('nannyHome')}
        onMessages={() => setScreen('nannyMessages')}
        onJobs={() => setScreen('nannyJobs')}
        onNotifications={() => setScreen('nannyNotifications')}
        onCalendar={() => setScreen('nannyCalendar')}
        onSettings={() => setScreen('nannySettings')}
      />
    );
  } else if (screen === 'nannyNotificationDetail') {
    renderedScreen = (
      <NotificationDetailScreen
        route={{ params: { item: selectedNotificationDetail || undefined } }}
        onBack={() => setScreen('nannyNotifications')}
      />
    );
  } else if (screen === 'nannyMessages') {
    renderedScreen = (
      <NannyMessagesScreen
        onOpenChat={(params) => {
          setSelectedNannyChatParams(params);
          setNannyChatOrigin('nannyMessages');
          setScreen('nannyChat');
        }}
        onHome={() => setScreen('nannyHome')}
        onJobs={() => setScreen('nannyJobs')}
        onMessages={() => setScreen('nannyMessages')}
        onNotifications={() => setScreen('nannyNotifications')}
        onCalendar={() => setScreen('nannyCalendar')}
        onSettings={() => setScreen('nannySettings')}
      />
    );
  } else if (screen === 'nannyChat') {
    renderedScreen = (
      <NannyChatScreen
        route={{ params: selectedNannyChatParams || undefined }}
        onBack={() => setScreen(nannyChatOrigin)}
        onCloseChat={() => setScreen(nannyChatOrigin)}
      />
    );
  } else if (screen === 'nannyAboutUs') {
    renderedScreen = <AboutUsScreen navigation={{ goBack: () => backFromStaticScreen('nannyAboutUs') }} />;
  } else if (screen === 'nannyContactUs') {
    renderedScreen = <ContactUsScreen navigation={{ goBack: () => backFromStaticScreen('nannyContactUs') }} />;
  } else if (screen === 'nannyFaq') {
    renderedScreen = (
      <NannyFaqScreen
        navigation={{
          goBack: () => backFromStaticScreen('nannyFaq'),
          navigate: (route: string) => {
            if (route === 'contactUs') {
              openStaticScreen('nannyContactUs', 'nannyFaq');
            }
          },
        }}
      />
    );
  } else if (screen === 'nannyInviteFriends') {
    renderedScreen = <InviteFriendsScreen navigation={{ goBack: () => backFromStaticScreen('nannyInviteFriends') }} />;
  } else if (screen === 'nannyRateApp') {
    renderedScreen = <RateAppScreen navigation={{ goBack: () => backFromStaticScreen('nannyRateApp') }} />;
  } else if (screen === 'nannyTerms') {
    renderedScreen = <TermsConditionsScreen navigation={{ goBack: () => backFromStaticScreen('nannyTerms') }} />;
  } else if (screen === 'nannyPrivacy') {
    renderedScreen = <PrivacyPolicyScreen navigation={{ goBack: () => backFromStaticScreen('nannyPrivacy') }} />;
  } else if (screen === 'signupNanny') {
    renderedScreen = (
      <SignupNannyScreen
        onBack={() => {
          setPendingNannySignup(null);
          setScreen('welcome');
        }}
        onLoginPress={() => {
          setPendingNannySignup(null);
          setScreen('login');
        }}
        onTermsPress={() => openStaticScreen('signupNannyTerms')}
        onPrivacyPress={() => openStaticScreen('signupNannyPrivacy')}
        onSuccess={(data) => {
          setPendingNannySignup(data ?? null);
          setScreen('createNannyProfile');
        }}
      />
    );
  } else if (screen === 'signupClient') {
    renderedScreen = (
      <SignUpClientScreen
        onBack={() => setScreen('welcome')}
        onLoginPress={() => setScreen('login')}
        onTermsPress={() => openStaticScreen('signupClientTerms')}
        onPrivacyPress={() => openStaticScreen('signupClientPrivacy')}
        onSuccess={() => setScreen('createClientProfile')}
      />
    );
  } else if (screen === 'signupClientTerms') {
    renderedScreen = <TermsConditionsScreen navigation={{ goBack: () => backFromStaticScreen('signupClientTerms') }} />;
  } else if (screen === 'signupClientPrivacy') {
    renderedScreen = <PrivacyPolicyScreen navigation={{ goBack: () => backFromStaticScreen('signupClientPrivacy') }} />;
  } else if (screen === 'signupNannyTerms') {
    renderedScreen = <TermsConditionsScreen navigation={{ goBack: () => backFromStaticScreen('signupNannyTerms') }} />;
  } else if (screen === 'signupNannyPrivacy') {
    renderedScreen = <PrivacyPolicyScreen navigation={{ goBack: () => backFromStaticScreen('signupNannyPrivacy') }} />;
  } else if (screen === 'forgotPassword') {
    renderedScreen = (
      <ForgotPasswordScreen
        navigation={{ goBack: () => setScreen('login') }}
        onBack={() => setScreen(forgotPasswordBackTarget)}
      />
    );
  } else if (screen === 'createClientProfile') {
    renderedScreen = (
      <CreateClientProfileScreen
        onBack={() => setScreen('signupClient')}
        onNext={() => setScreen('createKids')}
      />
    );
  } else if (screen === 'createKids') {
    renderedScreen = (
      <CreateKidsScreen
        onBack={() => setScreen('createClientProfile')}
        onDone={() => {
          setVerificationOrigin('kids');
          setScreen('getVerified');
        }}
      />
    );
  } else if (screen === 'getVerified') {
    renderedScreen = (
      <GetVerifiedScreen
        onBack={() => {
          if (verificationOrigin === 'nannyVerification') {
            return;
          }
          if (verificationOrigin === 'availability') {
            setScreen('availability');
            return;
          }
          if (verificationOrigin === 'loginPending') {
            setScreen('login');
            return;
          }
          if (verificationOrigin === 'home') {
            setScreen('parentHome');
            return;
          }
          setScreen('createKids');
        }}
        onStart={() =>
          setScreen('verificationUnderReview')
        }
        onNext={() => setScreen('verificationUnderReview')}
        onRejected={async () => {
          const [[, userType], [, nannyId]] = await AsyncStorage.multiGet([
            'user_type',
            'nanny_id',
          ]);
          const normalizedUserType = String(userType || '').toLowerCase().trim();
          const isNannyUser =
            normalizedUserType === 'nanny' ||
            normalizedUserType === 'syttr' ||
            !!String(nannyId || '').trim();
          setScreen(isNannyUser ? 'interviewPending' : 'parentBlacklist');
        }}
        onAddPaymentMethod={() => {
          setPaymentMethodsOrigin('getVerified');
          setScreen('paymentMethods');
        }}
        onContactSupport={() => {
          if (verificationOrigin === 'kids' || verificationOrigin === 'home') {
            openStaticScreen('parentContactUs', 'getVerified');
            return;
          }
          openStaticScreen('nannyContactUs', 'getVerified');
        }}
        onLogout={() => setScreen('login')}
        onSkip={() => {
          if (verificationOrigin === 'loginPending') {
            setScreen('login');
            return;
          }
          if (verificationOrigin === 'availability') {
            setScreen('availability');
            return;
          }
          if (verificationOrigin === 'nannyVerification') {
            return;
          }
          setScreen('parentHome');
        }}
      />
    );
  } else if (screen === 'createNannyProfile') {
    renderedScreen = (
      <CreateNannyProfileScreen
        signupData={pendingNannySignup}
        onBack={() => {
          setPendingNannySignup(null);
          setScreen('signupNanny');
        }}
        onSuccess={() => {
          setPendingNannySignup(null);
          setAvailabilityOrigin('profile');
          setScreen('availability');
        }}
      />
    );
  } else if (screen === 'availability') {
    renderedScreen = (
      <AvailabilityScreen
        onBack={() =>
          setScreen(
            availabilityOrigin === 'home'
              ? 'nannyHome'
              : availabilityOrigin === 'settings'
              ? 'nannySettings'
              : 'createNannyProfile'
          )
        }
        onSuccess={() => {
          if (availabilityOrigin === 'home') {
            setScreen('nannyHome');
            return;
          }
          if (availabilityOrigin === 'settings') {
            setScreen('nannySettings');
            return;
          }
          setVerificationOrigin('availability');
          setScreen('getVerified');
        }}
      />
    );
  } else if (screen === 'interviewSchedule') {
    renderedScreen = (
      <InterviewScheduleScreen
        onBack={() =>
          setScreen(
            verificationOrigin === 'availability' || verificationOrigin === 'loginPending'
              ? 'getVerified'
              : 'login'
          )
        }
        onSuccess={() => setScreen('interviewPending')}
      />
    );
  } else if (screen === 'interviewPending') {
    renderedScreen = (
      <InterviewPendingScreen
        onBack={() => setScreen('login')}
        onDone={async () => {
          await AsyncStorage.multiSet([
            ['nanny_approval_state', 'approved'],
            ['user_verification_status', 'approved'],
          ]);
          setScreen('nannyHome');
        }}
        onRejected={() => setScreen('login')}
      />
    );
  } else if (screen === 'verificationUnderReview') {
    renderedScreen = (
      <VerificationUnderReviewScreen
        onDone={async () => {
          const [[, userType], [, nannyId]] = await AsyncStorage.multiGet([
            'user_type',
            'nanny_id',
          ]);
          const normalizedUserType = String(userType || '').toLowerCase().trim();
          const isNannyUser =
            normalizedUserType === 'nanny' ||
            normalizedUserType === 'syttr' ||
            !!String(nannyId || '').trim();
          setScreen(isNannyUser ? 'nannyHome' : 'parentHome');
        }}
        onRejected={async () => {
          const [[, userType], [, nannyId]] = await AsyncStorage.multiGet([
            'user_type',
            'nanny_id',
          ]);
          const normalizedUserType = String(userType || '').toLowerCase().trim();
          const isNannyUser =
            normalizedUserType === 'nanny' ||
            normalizedUserType === 'syttr' ||
            !!String(nannyId || '').trim();
          setScreen(isNannyUser ? 'interviewPending' : 'parentBlacklist');
        }}
      />
    );
  } else {
    renderedScreen = (
      <LoginScreen
        onBack={() => setScreen('welcome')}
        onSignupClient={() => setScreen('signupClient')}
        onSignupNanny={() => setScreen('signupNanny')}
        onTermsPress={() => openStaticScreen('signupClientTerms', 'login')}
        onPrivacyPress={() => openStaticScreen('signupClientPrivacy', 'login')}
      />
    );
  }

  const wrappedScreen = screensNeedingGlobalSafeArea.has(screen) ? (
    <SafeAreaView style={styles.safeArea} edges={['top', 'right', 'bottom', 'left']}>
      {renderedScreen}
    </SafeAreaView>
  ) : (
    renderedScreen
  );

  return (
    <Animated.View style={[styles.container, transitionStyle]}>
      {wrappedScreen}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  safeArea: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
});
